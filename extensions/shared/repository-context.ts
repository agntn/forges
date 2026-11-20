import { execFile } from "node:child_process";

/** Every platform the tools take, spelled the way the `platform` parameter does. */
export type ContextPlatform =
  | "github"
  | "gitlab"
  | "gitea"
  | "bitbucket"
  | "gitee"
  | "azure-devops"
  | "artifacts";

export const platformLabels: Record<ContextPlatform, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  bitbucket: "Bitbucket",
  gitee: "Gitee",
  "azure-devops": "Azure DevOps",
  artifacts: "Cloudflare Artifacts",
};

/** The prompt section's tag, which Pi also uses as its key. */
export const REPOSITORY_SECTION = "forges_repository";

/** A remote that points at a forge the tools can reach. */
export interface ForgeRemote {
  remote: string;
  platform: ContextPlatform;
  owner: string;
  repo: string;
}

/** The web host behind each provider's default API, the variable that moves it, its API path. */
const endpoints: Partial<Record<ContextPlatform, { host: string; variable: string; api: RegExp }>> =
  {
    github: { host: "github.com", variable: "FORGES_GITHUB_BASE_URL", api: /\/api\/v3$/ },
    gitlab: { host: "gitlab.com", variable: "FORGES_GITLAB_BASE_URL", api: /\/api\/v4$/ },
    gitea: { host: "gitea.com", variable: "FORGES_GITEA_BASE_URL", api: /\/api\/v1$/ },
    bitbucket: { host: "bitbucket.org", variable: "FORGES_BITBUCKET_BASE_URL", api: /\/2\.0$/ },
    gitee: { host: "gitee.com", variable: "FORGES_GITEE_BASE_URL", api: /\/api\/v5$/ },
  };

const azureHosts = new Set(["dev.azure.com", "ssh.dev.azure.com"]);

function bareHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^api\./, "");
}

/** Where a forge lives: its host and the path it's installed under, like `/gitlab`. */
interface Endpoint {
  platform: ContextPlatform;
  prefix: string;
}

/** The forge the tools would actually call; a web remote on another port is another forge. */
function endpointOf(location: Location): Endpoint | undefined {
  const name = bareHost(location.host);
  if (azureHosts.has(name) || name.endsWith(".visualstudio.com")) {
    return { platform: "azure-devops", prefix: "" };
  }
  for (const [platform, { host: fallback, variable, api }] of Object.entries(endpoints)) {
    const value = process.env[variable!];
    if (value === undefined || value === "") {
      if (fallback === name) return { platform: platform as ContextPlatform, prefix: "" };
      continue;
    }
    if (!URL.canParse(value)) continue;
    const base = new URL(value);
    if (bareHost(base.hostname) !== name) continue;
    if (
      location.web &&
      webPort(location.protocol, location.port) !== webPort(base.protocol, base.port)
    ) {
      continue;
    }
    const prefix = base.pathname.replace(/\/+$/, "").replace(api!, "");
    return { platform: platform as ContextPlatform, prefix };
  }
  return undefined;
}

/** Where a remote points; only a web URL carries the forge's install path and port. */
interface Location {
  host: string;
  path: string;
  web: boolean;
  protocol: string;
  port: string;
}

function webPort(protocol: string, port: string): string {
  return port || (protocol === "http:" ? "80" : "443");
}

function hostAndPath(url: string): Location | undefined {
  if (URL.canParse(url) && /^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const { hostname, pathname, protocol, port } = new URL(url);
    const web = protocol === "https:" || protocol === "http:";
    return { host: hostname, path: pathname, web, protocol, port };
  }
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(url);
  return scp ? { host: scp[1]!, path: scp[2]!, web: false, protocol: "ssh:", port: "" } : undefined;
}

/** Names land in the system prompt, so anything past a forge's own alphabet is refused. */
const segment = /^[\w.-]+$/;
const azureSegment = /^[\w. -]+$/;

function decoded(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

/** The repository a remote names; GitLab groups nest, Azure owners are `org/project`. */
export function parseRemote(remote: string, url: string): ForgeRemote | undefined {
  if (!segment.test(remote)) return undefined;
  const location = hostAndPath(url.trim());
  if (!location) return undefined;
  const endpoint = endpointOf(location);
  if (!endpoint) return undefined;
  const { platform, prefix } = endpoint;
  const inside = !location.web || !prefix || location.path.startsWith(`${prefix}/`);
  if (!inside) return undefined;
  const path = location.web ? location.path.slice(prefix.length) : location.path;
  const parts = path
    .replace(/\.git\/?$/, "")
    .split("/")
    .filter(Boolean)
    .map(decoded);
  if (parts.some((part) => part === undefined)) return undefined;
  let names = parts as string[];
  let pattern = segment;
  if (platform === "azure-devops") {
    if (!location.web && names[0] === "v3") names.shift();
    if (location.web && names.at(-2) === "_git") names.splice(-2, 1);
    const host = bareHost(location.host);
    if (host.endsWith(".visualstudio.com"))
      names.unshift(host.slice(0, -".visualstudio.com".length));
    if (names.length !== 3) return undefined;
    pattern = azureSegment;
  } else if (platform === "gitlab") {
    if (names.length < 2) return undefined;
  } else if (names.length !== 2) {
    return undefined;
  }
  if (!names.every((name) => pattern.test(name))) return undefined;
  const repo = names.pop()!;
  return { remote, platform, owner: names.join("/"), repo };
}

/** Without the host's `GIT_*`, so a stray `GIT_DIR` can't swap in another repository. */
const gitEnvironment = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
  ),
  GIT_TERMINAL_PROMPT: "0",
});

/** `git config` straight, so a repo without remotes or a directory outside Git answers nothing. */
function remoteUrls(cwd: string): Promise<[string, string][]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["--no-pager", "config", "--local", "--null", "--get-regexp", String.raw`^remote\..*\.url$`],
      { cwd, encoding: "utf8", timeout: 2_000, env: gitEnvironment() },
      (error, stdout) => {
        if (error) return resolve([]);
        const entries = stdout
          .split("\0")
          .filter(Boolean)
          .map((entry): [string, string] => {
            const [key = "", url = ""] = entry.split("\n");
            return [key.slice("remote.".length, -".url".length), url];
          });
        resolve(entries);
      },
    );
  });
}

/** origin and upstream first, since those are the ones a contribution works between. */
function rank(remote: string): number {
  return remote === "origin" ? 0 : remote === "upstream" ? 1 : 2;
}

/** The forge remotes of the checkout at `cwd`, at most four. */
export async function forgeRemotes(cwd: string): Promise<ForgeRemote[]> {
  const seen = new Set<string>();
  return (await remoteUrls(cwd))
    .map(([remote, url]) => parseRemote(remote, url))
    .filter((remote): remote is ForgeRemote => remote !== undefined)
    .filter(({ remote }) => !seen.has(remote) && Boolean(seen.add(remote)))
    .sort((a, b) => rank(a.remote) - rank(b.remote))
    .slice(0, 4);
}

/** The section body, or undefined when no remote points at a forge. */
export function repositorySection(remotes: readonly ForgeRemote[]): string | undefined {
  if (remotes.length === 0) return undefined;
  const lines = remotes.map(
    ({ remote, platform, owner, repo }) =>
      `- ${remote}: ${owner}/${repo} on ${platformLabels[platform]} (platform "${platform}", owner "${owner}", repo "${repo}")`,
  );
  return [
    "The working directory is a Git checkout. Its forge remotes, which forges tools reach with these arguments:",
    ...lines,
  ].join("\n");
}

/** Read the checkout and build the section in one go. */
export async function repositoryContext(cwd: string): Promise<string | undefined> {
  return repositorySection(await forgeRemotes(cwd));
}

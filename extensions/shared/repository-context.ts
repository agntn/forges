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

const publicHosts: Record<string, ContextPlatform> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "gitea.com": "gitea",
  "codeberg.org": "gitea",
  "bitbucket.org": "bitbucket",
  "gitee.com": "gitee",
  "dev.azure.com": "azure-devops",
  "ssh.dev.azure.com": "azure-devops",
};

const baseUrlEnv: Partial<Record<ContextPlatform, string>> = {
  github: "FORGES_GITHUB_BASE_URL",
  gitlab: "FORGES_GITLAB_BASE_URL",
  gitea: "FORGES_GITEA_BASE_URL",
  bitbucket: "FORGES_BITBUCKET_BASE_URL",
  gitee: "FORGES_GITEE_BASE_URL",
  "azure-devops": "FORGES_AZURE_DEVOPS_BASE_URL",
};

function bareHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^api\./, "");
}

/** A public forge by name, or a self-hosted one a `FORGES_*_BASE_URL` points at. */
function platformOf(host: string): ContextPlatform | undefined {
  const name = bareHost(host);
  const known = publicHosts[name];
  if (known !== undefined) return known;
  if (name.endsWith(".ghe.com")) return "github";
  if (name.endsWith(".visualstudio.com")) return "azure-devops";
  for (const [platform, variable] of Object.entries(baseUrlEnv)) {
    const value = process.env[variable!];
    if (value && URL.canParse(value) && bareHost(new URL(value).hostname) === name) {
      return platform as ContextPlatform;
    }
  }
  return undefined;
}

/** Host and path of a remote URL, from `https://`, `ssh://` or scp-style `git@host:path`. */
function hostAndPath(url: string): { host: string; path: string } | undefined {
  if (URL.canParse(url) && /^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const parsed = new URL(url);
    return { host: parsed.hostname, path: parsed.pathname };
  }
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(url);
  return scp ? { host: scp[1]!, path: scp[2]! } : undefined;
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
  const platform = platformOf(location.host);
  if (!platform) return undefined;
  const parts = location.path
    .replace(/\.git\/?$/, "")
    .split("/")
    .filter(Boolean)
    .map(decoded);
  if (parts.some((part) => part === undefined)) return undefined;
  let names = parts as string[];
  let pattern = segment;
  if (platform === "azure-devops") {
    names = names.filter((part) => part !== "_git" && part !== "v3");
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
      ["--no-pager", "config", "--null", "--get-regexp", String.raw`^remote\..*\.url$`],
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

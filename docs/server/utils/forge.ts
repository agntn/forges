import { createProvider, type Platform, type Provider } from "@agntn/forges";

export type { Platform };

export const PLATFORMS: readonly Platform[] = ["github", "gitlab", "gitea"];

/** The token env vars per platform, in the order `resolveToken()` reads them. */
const TOKEN_ENV: Record<Platform, readonly string[]> = {
  github: ["GH_TOKEN", "GITHUB_TOKEN"],
  gitlab: ["GITLAB_TOKEN", "GL_TOKEN", "GITLAB_PAT"],
  gitea: ["GITEA_TOKEN"],
};

/** Optional self-hosted endpoint per platform, the same variables the agent tools read. */
const BASE_ENV: Record<Platform, string> = {
  github: "FORGES_GITHUB_BASE_URL",
  gitlab: "FORGES_GITLAB_BASE_URL",
  gitea: "FORGES_GITEA_BASE_URL",
};

export function readPlatform(query: Record<string, unknown>): Platform {
  const value = query.platform;
  const name = Array.isArray(value) ? value[0] : value;
  if (name === "github" || name === "gitlab" || name === "gitea") {
    return name;
  }
  throw createError({ statusCode: 400, statusMessage: "platform must be github, gitlab or gitea" });
}

/** The worker's token for a platform, or the empty string for anonymous reads. */
export function workerToken(platform: Platform): string {
  for (const key of TOKEN_ENV[platform]) {
    const value = process.env[key];
    if (value) {
      return value;
    }
  }
  return "";
}

export function workerBaseURL(platform: Platform): string | undefined {
  return process.env[BASE_ENV[platform]] || undefined;
}

/** Public Gitea-compatible hosts the explorer may address besides the platform default. */
const GITEA_HOSTS: Record<string, string> = {
  "gitea.com": "https://gitea.com",
  "codeberg.org": "https://codeberg.org",
};

/** The `host` parameter, Gitea only. Off the allowlist is a 400, the worker is not a proxy. */
export function readHost(query: Record<string, unknown>, platform: Platform): string | undefined {
  const value = query.host;
  const host = Array.isArray(value) ? value[0] : value;
  if (host === undefined || host === "") {
    return undefined;
  }
  if (platform !== "gitea" || typeof host !== "string" || !(host in GITEA_HOSTS)) {
    throw createError({
      statusCode: 400,
      statusMessage: "host must be gitea.com or codeberg.org, and only for gitea",
    });
  }
  return GITEA_HOSTS[host];
}

/** Whether the worker holds a credential for the platform; never the credential itself. */
export function platformStatus(platform: Platform): {
  platform: Platform;
  authenticated: boolean;
  host: string;
} {
  const base = workerBaseURL(platform);
  const host = base
    ? new URL(base).hostname
    : platform === "github"
      ? "api.github.com"
      : platform === "gitlab"
        ? "gitlab.com"
        : "gitea.com";
  return { platform, authenticated: workerToken(platform) !== "", host };
}

const providers = new Map<string, Provider>();

/** One provider per platform and host. Token always explicit, so nothing shells out to `gh` on a Worker. */
export function forge(platform: Platform, host?: string): Provider {
  const key = `${platform} ${host ?? ""}`;
  let provider = providers.get(key);
  if (!provider) {
    provider = createProvider(platform, {
      token: host ? "" : workerToken(platform),
      baseURL: host ?? workerBaseURL(platform),
      /** Nitro caches the whole answer, a second LRU per isolate would be dead weight. */
      cache: { enabled: false },
    });
    providers.set(key, provider);
  }
  return provider;
}

/**
 * UGP - Unified Git Provider
 * Main entry point with factory function and public API exports
 */

import type { Provider } from "./provider.ts";
import type { ProviderConfig } from "./types.ts";
import { resolveCloudflareCredential, resolveToken } from "./auth.ts";
import type { Platform } from "./auth.ts";
import { AuthenticationError, ForgesError } from "./errors.ts";
import { lazy, oneAtATime } from "../extensions/shared/lazy.ts";

// --- Type exports ---
export type * from "./types.ts";

export { Provider } from "./provider.ts";
export type { ProviderRawTypes } from "./provider.ts";

// --- Auth exports ---
export { resolveToken } from "./auth.ts";
export type { Platform, AuthResult } from "./auth.ts";

// --- Error exports ---
export {
  ForgesError,
  NotFoundError,
  AuthenticationError,
  PermissionError,
  RateLimitError,
  normalizeError,
  type FixedStatusErrorOptions,
  type ForgesErrorOptions,
} from "./errors.ts";

// --- Utility exports ---
export {
  parseLinkHeader,
  paginate,
  fetchAllPages,
  type LinkHeaderEntry,
  type PaginationOptions,
  type PaginationRequest,
} from "./pagination.ts";

export {
  createForgeClient,
  rawFetch,
  FetchError,
  type ForgeClientOptions,
  type HttpClient,
  type RawFetchResult,
  type RawRequest,
  type RequestOptions,
  type ResponseData,
  type ResponseType,
} from "./http.ts";

export {
  createCache,
  configureStorage,
  cachedFetch,
  clearCache,
  invalidateCache,
  type CacheOptions,
  type CachedFetchOptions,
  type CachedRequest,
} from "./cache.ts";

type ProviderConstructor = new (config: ProviderConfig) => Provider;

/** Every platform createProvider builds: the three forges and Cloudflare Artifacts. */
export type ProviderPlatform = Platform | "artifacts";

/**
 * Built-in providers, keyed by platform.
 *
 * Each loader imports one provider module on demand, so a process that talks to
 * GitHub never parses the GitLab or Gitea implementation. The specifiers stay
 * literal for the bundler to split them into their own chunks. Concurrent first
 * calls share one import, and imports of different providers wait their turn,
 * since the uncached jiti Pi loads extensions with hands an overlapping one an
 * empty namespace.
 */
const queued = /* @__PURE__ */ oneAtATime();

const providers: Record<ProviderPlatform, () => Promise<ProviderConstructor>> = {
  github: /* @__PURE__ */ lazy(
    /* @__PURE__ */ queued(() => import("./providers/github.ts").then((m) => m.GitHubProvider)),
  ),
  gitlab: /* @__PURE__ */ lazy(
    /* @__PURE__ */ queued(() => import("./providers/gitlab.ts").then((m) => m.GitLabProvider)),
  ),
  gitea: /* @__PURE__ */ lazy(
    /* @__PURE__ */ queued(() => import("./providers/gitea.ts").then((m) => m.GiteaProvider)),
  ),
  artifacts: /* @__PURE__ */ lazy(
    /* @__PURE__ */ queued(() =>
      import("./providers/artifacts.ts").then((m) => m.ArtifactsProvider),
    ),
  ),
};

/**
 * Create a provider instance.
 * If no token is provided, attempts to auto-detect from:
 *   1. Environment variables (GITHUB_TOKEN, GITLAB_TOKEN, etc.)
 *   2. CLI tools (gh, glab)
 *   3. CLI config files (~/.config/gh/hosts.yml, etc.)
 *
 * `artifacts` takes a Cloudflare token and account instead: from the config,
 * then `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, then the cf CLI session.
 *
 * The provider module loads only after a token is resolved, so a missing
 * credential fails before any platform code is parsed.
 */
export async function createProvider(
  platform: ProviderPlatform,
  config?: ProviderConfig,
): Promise<Provider> {
  if (!Object.hasOwn(providers, platform)) {
    throw new ForgesError(
      `Unsupported platform: ${platform}. Supported: github, gitlab, gitea, artifacts`,
      { platform },
    );
  }

  if (platform === "artifacts") {
    const { accountId } = await resolveCloudflareCredential({
      token: config?.token,
      accountId: config?.accountId,
    });
    const ArtifactsProvider = await providers.artifacts();
    return new ArtifactsProvider({ ...config, accountId });
  }

  const resolved = resolveToken(platform, {
    token: config?.token,
    baseURL: config?.baseURL,
  });

  if (!resolved) {
    throw new AuthenticationError(
      `No auth token found for ${platform}. ` +
        `Set ${envHint(platform)}, pass { token: '...' }, ` +
        `or log in with ${cliHint(platform)}.`,
      { platform },
    );
  }

  const ProviderClass = await providers[platform]();
  return new ProviderClass({ ...config, token: resolved.token });
}

function envHint(platform: string): string {
  switch (platform) {
    case "github":
      return "GITHUB_TOKEN";
    case "gitlab":
      return "GITLAB_TOKEN";
    case "gitea":
      return "GITEA_TOKEN";
    default:
      return `${platform.toUpperCase()}_TOKEN`;
  }
}

function cliHint(platform: string): string {
  switch (platform) {
    case "github":
      return "`gh auth login`";
    case "gitlab":
      return "`glab auth login`";
    case "gitea":
      return "`tea login add`";
    default:
      return "the platform CLI";
  }
}

export default createProvider;

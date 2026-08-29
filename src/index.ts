/**
 * UGP - Unified Git Provider
 * Main entry point with factory function and public API exports
 */

import { Provider } from "./provider.ts";
import type { ProviderConfig } from "./types.ts";
import { GitHubProvider } from "./providers/github.ts";
import { GitLabProvider } from "./providers/gitlab.ts";
import { GiteaProvider } from "./providers/gitea.ts";
import { resolveToken } from "./auth.ts";
import type { Platform } from "./auth.ts";
import { AuthenticationError, ForgesError } from "./errors.ts";

// --- Type exports ---
export type {
  User,
  Owner,
  RepositoryParent,
  RepositoryPermission,
  Repository,
  CiRunStatus,
  CiRunConclusion,
  CiRun,
  IssueState,
  Issue,
  PullRequestSearchItem,
  PullRequest,
  Comment,
  ThreadState,
  ThreadComment,
  Thread,
  PageResult,
  SearchPageResult,
  ListOptions,
  ListCiRunsOptions,
  ListCommentOptions,
  ListThreadOptions,
  CreateIssueInput,
  CreatePullRequestInput,
  ReplyThreadInput,
  ProviderConfig,
  RepositoryResource,
  CiRunResource,
  IssueResource,
  PullRequestResource,
  UserResource,
  ThreadResource,
} from "./types.ts";

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
} from "./errors.ts";

// --- Utility exports ---
export {
  parseLinkHeader,
  paginate,
  fetchAllPages,
  type LinkHeaderEntry,
  type PaginationOptions,
} from "./pagination.ts";

export {
  createHttpClient,
  rawFetch,
  FetchError,
  type HttpClient,
  type RawFetchResult,
} from "./http.ts";

export {
  createCache,
  configureStorage,
  cachedFetch,
  clearCache,
  invalidateCache,
  type CacheOptions,
  type CachedFetchOptions,
} from "./cache.ts";

/**
 * Create a provider instance.
 * If no token is provided, attempts to auto-detect from:
 *   1. Environment variables (GITHUB_TOKEN, GITLAB_TOKEN, etc.)
 *   2. CLI tools (gh, glab)
 *   3. CLI config files (~/.config/gh/hosts.yml, etc.)
 */
export function createProvider(
  platform: "github" | "gitlab" | "gitea",
  config?: ProviderConfig,
): Provider {
  const resolved = resolveToken(platform as Platform, {
    token: config?.token,
    baseURL: config?.baseURL,
  });

  if (!resolved) {
    throw new AuthenticationError(
      `No auth token found for ${platform}. ` +
        `Set ${envHint(platform)}, pass { token: '...' }, ` +
        `or log in with ${cliHint(platform)}.`,
      platform,
    );
  }

  const finalConfig: ProviderConfig = {
    ...config,
    token: resolved.token,
  };

  switch (platform) {
    case "github":
      return new GitHubProvider(finalConfig);
    case "gitlab":
      return new GitLabProvider(finalConfig);
    case "gitea":
      return new GiteaProvider(finalConfig);
    default:
      throw new ForgesError(
        `Unsupported platform: ${platform}. Supported: github, gitlab, gitea`,
        undefined,
        platform,
      );
  }
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

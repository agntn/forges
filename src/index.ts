/**
 * UGP - Unified Git Provider
 * Main entry point with factory function and public API exports
 */

import type { ProviderConfig, Provider } from "./types.js";
import { GitHubProvider } from "./providers/github.js";
import { GitLabProvider } from "./providers/gitlab.js";
import { createGiteaProvider } from "./providers/gitea.js";
import { resolveToken } from "./auth.js";
import type { Platform } from "./auth.js";
import { AuthenticationError, GixaError } from "./errors.js";

// --- Type exports ---
export type {
  User,
  Owner,
  Repository,
  IssueState,
  Issue,
  PullRequest,
  PageResult,
  ListOptions,
  CreateIssueInput,
  CreatePullRequestInput,
  ProviderConfig,
  RepositoryResource,
  IssueResource,
  PullRequestResource,
  UserResource,
  Provider,
} from "./types.js";

// --- Auth exports ---
export { resolveToken } from "./auth.js";
export type { Platform, AuthResult } from "./auth.js";

// --- Error exports ---
export {
  GixaError,
  NotFoundError,
  AuthenticationError,
  RateLimitError,
  normalizeError,
} from "./errors.js";

// --- Utility exports ---
export {
  parseLinkHeader,
  paginate,
  fetchAllPages,
  type LinkHeaderEntry,
  type PaginationOptions,
} from "./pagination.js";

export { createHttpClient, rawFetch, FetchError } from "./http.js";

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
      return createGiteaProvider(finalConfig);
    default:
      throw new GixaError(`Unsupported platform: ${platform}. Supported: github, gitlab, gitea`);
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

/**
 * UGP - Unified Git Provider
 * Main entry point with factory function and public API exports
 */

import type { Provider } from "./provider.ts";
import type { ProviderConfig } from "./types.ts";
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
  RepositoryEntryType,
  RepositoryEntry,
  RepositoryContentsOptions,
  RepositoryFileContents,
  RepositoryDirectoryContents,
  RepositoryContents,
  ContributionTemplateKind,
  ContributionTemplateScope,
  ContributionTemplateSummary,
  ContributionTemplate,
  CiRunStatus,
  CiRunConclusion,
  CiRun,
  CiJobStep,
  CiJob,
  CiJobLog,
  CiJobLogOptions,
  ChangedFileStatus,
  ChangedFile,
  CommitIdentity,
  CommitSummary,
  CommitSearchOptions,
  CommitSearchResult,
  CommitSearchItem,
  Commit,
  CommitPatchState,
  CommitPatchFile,
  CommitPatchOptions,
  CommitPatch,
  Release,
  IssueState,
  Issue,
  PullRequestSearchItem,
  GlobalPullRequestSearchOptions,
  GlobalPullRequestSearchResult,
  GlobalPullRequestSearchItem,
  PullRequest,
  ClosingIssue,
  GetPullRequestOptions,
  PullRequestFileStatus,
  PullRequestFile,
  PullRequestReviewState,
  PullRequestReview,
  Comment,
  ThreadState,
  ThreadComment,
  Thread,
  PageResult,
  SearchPageResult,
  CodeSearchItem,
  CodeSearchOptions,
  ListOptions,
  ListCiRunsOptions,
  ListCiJobsOptions,
  ListCommentOptions,
  ListContributionTemplatesOptions,
  ListCommitOptions,
  ListPullRequestFilesOptions,
  ListPullRequestChecksOptions,
  ListPullRequestReviewsOptions,
  ListReleasesOptions,
  ListThreadOptions,
  CreateCommentInput,
  CreateIssueInput,
  CreatePullRequestInput,
  CreateReleaseInput,
  UpdatePullRequestInput,
  UpdateReleaseInput,
  ReplyThreadInput,
  ProviderConfig,
  RepositoryResource,
  ContributionTemplateResource,
  CodeSearchResource,
  CiRunResource,
  CommitResource,
  ReleaseResource,
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

type ProviderConstructor = new (config: ProviderConfig) => Provider;

/**
 * Built-in providers, keyed by platform.
 *
 * Each loader imports one provider module on demand, so a process that talks to
 * GitHub never parses the GitLab or Gitea implementation. The specifiers stay
 * literal for the bundler to split them into their own chunks.
 */
const providers: Record<Platform, () => Promise<ProviderConstructor>> = {
  github: () => import("./providers/github.ts").then((m) => m.GitHubProvider),
  gitlab: () => import("./providers/gitlab.ts").then((m) => m.GitLabProvider),
  gitea: () => import("./providers/gitea.ts").then((m) => m.GiteaProvider),
};

/**
 * Create a provider instance.
 * If no token is provided, attempts to auto-detect from:
 *   1. Environment variables (GITHUB_TOKEN, GITLAB_TOKEN, etc.)
 *   2. CLI tools (gh, glab)
 *   3. CLI config files (~/.config/gh/hosts.yml, etc.)
 *
 * The provider module loads only after a token is resolved, so a missing
 * credential fails before any platform code is parsed.
 */
export async function createProvider(
  platform: Platform,
  config?: ProviderConfig,
): Promise<Provider> {
  if (!Object.hasOwn(providers, platform)) {
    throw new ForgesError(
      `Unsupported platform: ${platform}. Supported: github, gitlab, gitea`,
      undefined,
      platform,
    );
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
      platform,
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

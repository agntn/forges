/**
 * GitHub provider entry point
 * Allows direct imports: import { GitHubProvider } from '@agntn/forges/github'
 */

export { GitHubProvider } from "./providers/github.ts";
export type {
  User,
  Owner,
  RepositoryParent,
  RepositoryPermission,
  Repository,
  IssueState,
  Issue,
  PullRequest,
  Comment,
  ThreadState,
  ThreadComment,
  Thread,
  PageResult,
  ListOptions,
  ListCommentOptions,
  ListThreadOptions,
  CreateIssueInput,
  CreatePullRequestInput,
  ReplyThreadInput,
  ProviderConfig,
  RepositoryResource,
  IssueResource,
  PullRequestResource,
  UserResource,
  ThreadResource,
} from "./types.ts";
export { Provider } from "./provider.ts";
export type { ProviderRawTypes } from "./provider.ts";

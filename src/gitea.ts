/**
 * Gitea provider entry point
 * Allows direct imports: import { GiteaProvider } from '@agntn/forges/gitea'
 */

export { GiteaProvider } from "./providers/gitea.ts";
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
  SearchPageResult,
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

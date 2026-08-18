/**
 * GitLab provider entry point
 * Allows direct imports: import { GitLabProvider } from '@agntn/forges/gitlab'
 */

export { GitLabProvider } from "./providers/gitlab.ts";
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
} from "./types.ts";
export { Provider } from "./provider.ts";
export type { ProviderRawTypes } from "./provider.ts";

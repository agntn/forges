/**
 * GitLab provider entry point
 * Allows direct imports: import { GitLabProvider } from 'gixa/gitlab'
 */

export { GitLabProvider } from "./providers/gitlab.js";
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

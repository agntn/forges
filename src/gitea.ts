/**
 * Gitea provider entry point
 * Allows direct imports: import { createGiteaProvider } from 'gixa/gitea'
 */

export { createGiteaProvider } from "./providers/gitea.js";
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

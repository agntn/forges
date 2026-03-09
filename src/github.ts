/**
 * GitHub provider entry point
 * Allows direct imports: import { GitHubProvider } from 'gixa/github'
 */

export { GitHubProvider } from "./providers/github.js";
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

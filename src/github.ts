/**
 * GitHub provider entry point
 * Allows direct imports: import { GitHubProvider } from 'gixa/github'
 */

export { GitHubProvider } from "./providers/github.ts";
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

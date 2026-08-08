/**
 * Gitea provider entry point
 * Allows direct imports: import { GiteaProvider } from 'gixa/gitea'
 */

export { GiteaProvider } from "./providers/gitea.ts";
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

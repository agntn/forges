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
  ContributionTemplateKind,
  ContributionTemplateScope,
  ContributionTemplateSummary,
  ContributionTemplate,
  IssueState,
  Issue,
  PullRequestSearchItem,
  PullRequest,
  Comment,
  ThreadState,
  ThreadComment,
  Thread,
  PageResult,
  SearchPageResult,
  ListOptions,
  ListCommentOptions,
  ListContributionTemplatesOptions,
  ListThreadOptions,
  CreateIssueInput,
  CreatePullRequestInput,
  ReplyThreadInput,
  ProviderConfig,
  RepositoryResource,
  ContributionTemplateResource,
  IssueResource,
  PullRequestResource,
  UserResource,
  ThreadResource,
} from "./types.ts";
export { Provider } from "./provider.ts";
export type { ProviderRawTypes } from "./provider.ts";

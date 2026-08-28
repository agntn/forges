/**
 * Core contracts for the unified abstract git provider API.
 * Normalizes across GitHub, GitLab, Gitea, and GitBucket APIs.
 */

/**
 * User information
 */
export interface User {
  id: string;
  login: string;
  name: string;
  email: string;
  avatarUrl: string;
  isAdmin: boolean;
  bio: string;
  company: string;
  location: string;
  website: string;
  followers: number;
  following: number;
  createdAt: string;
  url: string;
}

/**
 * Repository owner information
 */
export interface Owner {
  login: string;
  avatarUrl: string;
}

/**
 * Repository information
 */
export interface Repository {
  id: string;
  name: string;
  fullName: string;
  description: string;
  private: boolean;
  defaultBranch: string;
  url: string;
  cloneUrl: string;
  owner: Owner;
}

/**
 * Issue state
 */
export type IssueState = "open" | "closed";

/**
 * Issue information
 */
export interface Issue {
  id: string;
  number: number;
  title: string;
  body: string;
  state: IssueState;
  labels: string[];
  author: {
    login: string;
  };
  assignees: Array<{ login: string }>;
  createdAt: string;
  updatedAt: string;
  url: string;
}

/**
 * Pull request information
 */
export interface PullRequest extends Issue {
  sourceBranch: string;
  targetBranch: string;
  merged: boolean;
  draft: boolean;
  mergeCommitSha: string;
  headSha: string;
  mergeable: boolean | null;
  mergeStatus: string;
}

/**
 * Paginated result wrapper
 */
export interface PageResult<T> {
  items: T[];
  totalCount?: number;
  hasNextPage: boolean;
  nextPage?: number;
}

/**
 * List operation options
 */
export interface ListOptions {
  page?: number;
  perPage?: number;
  state?: IssueState | "all";
}

/**
 * Input for creating an issue
 */
export interface CreateIssueInput {
  title: string;
  body: string;
  labels?: string[];
  /** Assignee logins. GitLab Free accepts only one. */
  assignees?: string[];
}

/**
 * Input for creating a pull request
 */
export interface CreatePullRequestInput {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  draft?: boolean;
  /** Assignee logins. GitLab Free accepts only one. */
  assignees?: string[];
}

/**
 * One comment in an issue or pull-request discussion
 */
export interface Comment {
  id: string;
  body: string;
  author: {
    login: string;
  };
  url: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * List operation options for discussion comments
 */
export interface ListCommentOptions {
  page?: number;
  perPage?: number;
}

/**
 * Review-thread state filter
 */
export type ThreadState = "unresolved" | "resolved" | "all";

/**
 * One comment inside a review thread
 */
export interface ThreadComment {
  id: string;
  body: string;
  author: {
    login: string;
  };
  url: string;
  createdAt: string;
}

/**
 * Pull-request review thread
 */
export interface Thread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  comments: ThreadComment[];
}

/**
 * List operation options for review threads
 */
export interface ListThreadOptions {
  page?: number;
  perPage?: number;
  state?: ThreadState;
}

/**
 * Input for replying inside an existing review thread
 */
export interface ReplyThreadInput {
  body: string;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  baseURL?: string;
  token?: string;
  cache?: {
    enabled?: boolean;
    ttl?: number;
    prefix?: string;
  };
  gitlab?: {
    projectIdCacheMax?: number;
    projectIdCacheTtl?: number;
  };
}

/**
 * Resource accessor for repositories
 */
export interface RepositoryResource {
  list(owner: string, options?: ListOptions): Promise<PageResult<Repository>>;
  get(owner: string, repo: string): Promise<Repository>;
}

/**
 * Resource accessor for issues
 */
export interface IssueResource {
  list(owner: string, repo: string, options?: ListOptions): Promise<PageResult<Issue>>;
  get(owner: string, repo: string, number: number): Promise<Issue>;
  create(owner: string, repo: string, input: CreateIssueInput): Promise<Issue>;
  listComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>>;
  getComment(owner: string, repo: string, number: number, commentId: string): Promise<Comment>;
}

/**
 * Resource accessor for pull requests
 */
export interface PullRequestResource {
  list(owner: string, repo: string, options?: ListOptions): Promise<PageResult<PullRequest>>;
  get(owner: string, repo: string, number: number): Promise<PullRequest>;
  create(owner: string, repo: string, input: CreatePullRequestInput): Promise<PullRequest>;
  listComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>>;
  getComment(owner: string, repo: string, number: number, commentId: string): Promise<Comment>;
}

/**
 * Resource accessor for users
 */
export interface UserResource {
  get(username: string): Promise<User>;
  authenticated(): Promise<User>;
}

/**
 * Resource accessor for pull-request review threads
 */
export interface ThreadResource {
  list(
    owner: string,
    repo: string,
    number: number,
    options?: ListThreadOptions,
  ): Promise<PageResult<Thread>>;
  get(owner: string, repo: string, number: number, threadId: string): Promise<Thread>;
  reply(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
    input: ReplyThreadInput,
  ): Promise<ThreadComment>;
  resolve(owner: string, repo: string, number: number, threadId: string): Promise<Thread>;
  unresolve(owner: string, repo: string, number: number, threadId: string): Promise<Thread>;
}

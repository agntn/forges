/**
 * Core type definitions for unified git provider interface
 * Normalizes across GitHub, GitLab, Gitea, and GitBucket APIs
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
  createdAt: string;
  updatedAt: string;
}

/**
 * Pull request information
 */
export interface PullRequest extends Issue {
  sourceBranch: string;
  targetBranch: string;
  merged: boolean;
  draft: boolean;
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
}

/**
 * Resource accessor for pull requests
 */
export interface PullRequestResource {
  list(owner: string, repo: string, options?: ListOptions): Promise<PageResult<PullRequest>>;
  get(owner: string, repo: string, number: number): Promise<PullRequest>;
  create(owner: string, repo: string, input: CreatePullRequestInput): Promise<PullRequest>;
}

/**
 * Resource accessor for users
 */
export interface UserResource {
  get(username: string): Promise<User>;
  authenticated(): Promise<User>;
}

/**
 * Main provider interface - unified API for all git platforms
 */
export interface Provider {
  repos: RepositoryResource;
  issues: IssueResource;
  pullRequests: PullRequestResource;
  users: UserResource;
}

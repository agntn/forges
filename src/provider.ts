/**
 * Runtime contract shared by all git provider implementations.
 */

import type {
  CreateIssueInput,
  CreatePullRequestInput,
  Issue,
  IssueResource,
  ListOptions,
  Owner,
  PageResult,
  PullRequest,
  PullRequestResource,
  Repository,
  RepositoryResource,
  User,
  UserResource,
} from "./types.ts";

/**
 * Provider-specific response types consumed by the mapping contract.
 *
 * Concrete providers supply their raw API response types when extending
 * {@link Provider}.
 */
export interface ProviderRawTypes {
  owner: unknown;
  repository: unknown;
  issue: unknown;
  pullRequest: unknown;
  user: unknown;
}

/**
 * Abstract base for every git provider.
 *
 * Owns the unified resource surface while concrete providers implement the
 * platform-specific mapping and API operations.
 */
export abstract class Provider<Raw extends ProviderRawTypes = ProviderRawTypes> {
  public readonly repos: RepositoryResource;
  public readonly issues: IssueResource;
  public readonly pullRequests: PullRequestResource;
  public readonly users: UserResource;

  protected constructor() {
    this.repos = {
      list: (owner, options) => this.listRepos(owner, options),
      get: (owner, repo) => this.getRepo(owner, repo),
    };
    this.issues = {
      list: (owner, repo, options) => this.listIssues(owner, repo, options),
      get: (owner, repo, number) => this.getIssue(owner, repo, number),
      create: (owner, repo, input) => this.createIssue(owner, repo, input),
    };
    this.pullRequests = {
      list: (owner, repo, options) => this.listPullRequests(owner, repo, options),
      get: (owner, repo, number) => this.getPullRequest(owner, repo, number),
      create: (owner, repo, input) => this.createPullRequest(owner, repo, input),
    };
    this.users = {
      get: (username) => this.getUser(username),
      authenticated: () => this.getAuthenticatedUser(),
    };
  }

  protected abstract mapOwner(raw: Raw["owner"]): Owner;
  protected abstract mapRepository(raw: Raw["repository"]): Repository;
  protected abstract mapIssue(raw: Raw["issue"]): Issue;
  protected abstract mapPullRequest(raw: Raw["pullRequest"]): PullRequest;
  protected abstract mapUser(raw: Raw["user"]): User;

  protected abstract listRepos(
    owner: string,
    options?: ListOptions,
  ): Promise<PageResult<Repository>>;
  protected abstract getRepo(owner: string, repo: string): Promise<Repository>;
  protected abstract listIssues(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<Issue>>;
  protected abstract getIssue(owner: string, repo: string, number: number): Promise<Issue>;
  protected abstract createIssue(
    owner: string,
    repo: string,
    input: CreateIssueInput,
  ): Promise<Issue>;
  protected abstract listPullRequests(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<PullRequest>>;
  protected abstract getPullRequest(
    owner: string,
    repo: string,
    number: number,
  ): Promise<PullRequest>;
  protected abstract createPullRequest(
    owner: string,
    repo: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequest>;
  protected abstract getUser(username: string): Promise<User>;
  protected abstract getAuthenticatedUser(): Promise<User>;
}

/**
 * Runtime contract shared by all git provider implementations.
 */

import type {
  CreateIssueInput,
  CreatePullRequestInput,
  Issue,
  IssueResource,
  ListOptions,
  ListThreadOptions,
  Owner,
  PageResult,
  PullRequest,
  PullRequestResource,
  ReplyThreadInput,
  Repository,
  RepositoryResource,
  Thread,
  ThreadComment,
  ThreadResource,
  ThreadState,
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
  thread: unknown;
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
  public readonly threads: ThreadResource;

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
    this.threads = {
      list: (owner, repo, number, options) => this.listThreads(owner, repo, number, options),
      get: (owner, repo, number, threadId) => this.getThread(owner, repo, number, threadId),
      reply: (owner, repo, number, threadId, input) =>
        this.replyToThread(owner, repo, number, threadId, input),
      resolve: (owner, repo, number, threadId) => this.resolveThread(owner, repo, number, threadId),
      unresolve: (owner, repo, number, threadId) =>
        this.unresolveThread(owner, repo, number, threadId),
    };
  }

  protected abstract mapOwner(raw: Raw["owner"]): Owner;
  protected abstract mapRepository(raw: Raw["repository"]): Repository;
  protected abstract mapIssue(raw: Raw["issue"]): Issue;
  protected abstract mapPullRequest(raw: Raw["pullRequest"]): PullRequest;
  protected abstract mapUser(raw: Raw["user"]): User;
  protected abstract mapThread(raw: Raw["thread"]): Thread;

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
  protected abstract listThreads(
    owner: string,
    repo: string,
    number: number,
    options?: ListThreadOptions,
  ): Promise<PageResult<Thread>>;
  protected abstract getThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread>;
  protected abstract replyToThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
    input: ReplyThreadInput,
  ): Promise<ThreadComment>;
  protected abstract resolveThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread>;
  protected abstract unresolveThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread>;

  protected filterThreadsByState(threads: Thread[], state?: ThreadState): Thread[] {
    if (state === undefined || state === "all") {
      return threads;
    }
    const resolved = state === "resolved";
    return threads.filter((thread) => thread.isResolved === resolved);
  }
}

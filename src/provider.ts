/**
 * Runtime contract shared by all git provider implementations.
 */

import { assertAssignees } from "./assignees.ts";
import { ForgesError } from "./errors.ts";
import type {
  Comment,
  CreateIssueInput,
  CreatePullRequestInput,
  Issue,
  IssueResource,
  ListCommentOptions,
  ListOptions,
  ListThreadOptions,
  Owner,
  PageResult,
  PullRequest,
  PullRequestResource,
  PullRequestSearchItem,
  ReplyThreadInput,
  Repository,
  RepositoryResource,
  SearchPageResult,
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
  comment: unknown;
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
      search: async (owner, repo, query, options) => {
        if (query.trim() === "") {
          throw new ForgesError("Issue search query must not be empty", 400);
        }
        return this.searchIssues(owner, repo, query, options);
      },
      get: (owner, repo, number) => this.getIssue(owner, repo, number),
      create: async (owner, repo, input) => {
        assertAssignees(input.assignees);
        return this.createIssue(owner, repo, input);
      },
      listComments: (owner, repo, number, options) =>
        this.listIssueComments(owner, repo, number, options),
      getComment: (owner, repo, number, commentId) =>
        this.getIssueComment(owner, repo, number, commentId),
    };
    this.pullRequests = {
      list: (owner, repo, options) => this.listPullRequests(owner, repo, options),
      search: async (owner, repo, query, options) => {
        if (query.trim() === "") {
          throw new ForgesError("Pull-request search query must not be empty", 400);
        }
        return this.searchPullRequests(owner, repo, query, options);
      },
      get: (owner, repo, number) => this.getPullRequest(owner, repo, number),
      create: async (owner, repo, input) => {
        assertAssignees(input.assignees);
        return this.createPullRequest(owner, repo, input);
      },
      listComments: (owner, repo, number, options) =>
        this.listPullRequestComments(owner, repo, number, options),
      getComment: (owner, repo, number, commentId) =>
        this.getPullRequestComment(owner, repo, number, commentId),
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
  protected abstract mapComment(raw: Raw["comment"]): Comment;

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
  protected searchIssues(
    _owner: string,
    _repo: string,
    _query: string,
    _options?: ListOptions,
  ): Promise<SearchPageResult<Issue>> {
    return Promise.reject(new ForgesError("Issue search is not supported by this provider", 501));
  }
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
  protected searchPullRequests(
    _owner: string,
    _repo: string,
    _query: string,
    _options?: ListOptions,
  ): Promise<SearchPageResult<PullRequestSearchItem>> {
    return Promise.reject(
      new ForgesError("Pull-request search is not supported by this provider", 501),
    );
  }
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
  protected abstract listIssueComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>>;
  protected abstract listPullRequestComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>>;
  protected abstract getIssueComment(
    owner: string,
    repo: string,
    number: number,
    commentId: string,
  ): Promise<Comment>;
  protected abstract getPullRequestComment(
    owner: string,
    repo: string,
    number: number,
    commentId: string,
  ): Promise<Comment>;
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

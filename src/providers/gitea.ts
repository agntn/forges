/**
 * Gitea/Forgejo provider implementation
 * API v1 - similar to GitHub but with key differences:
 * - Base path: /api/v1
 * - Pagination uses `limit` param instead of `per_page`
 * - Some fields may be null where GitHub returns empty strings
 */

import { createHttpClient, rawFetch, type HttpClient } from "../http.ts";
import { cachedFetch } from "../cache.ts";
import { parseLinkHeader } from "../pagination.ts";
import { normalizeError, NotFoundError } from "../errors.ts";
import { encodePathSegment, normalizeApiBaseURL } from "./base-url.ts";
import { Provider, type ProviderRawTypes } from "../provider.ts";
import type {
  ProviderConfig,
  Repository,
  Issue,
  PullRequest,
  User,
  Owner,
  PageResult,
  ListOptions,
  ListCommentOptions,
  ListThreadOptions,
  Comment,
  CreateIssueInput,
  CreatePullRequestInput,
  ReplyThreadInput,
  Thread,
  ThreadComment,
} from "../types.ts";

// -- Raw Gitea API response types --

interface GiteaUser {
  id: number;
  login: string;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  is_admin?: boolean;
  description?: string | null;
  location?: string | null;
  website?: string | null;
  followers_count?: number;
  following_count?: number;
  created?: string;
  html_url?: string | null;
}

interface GiteaOwner {
  login: string;
  avatar_url?: string | null;
}

interface GiteaRepository {
  id: number;
  name: string;
  full_name: string;
  description?: string | null;
  private: boolean;
  default_branch?: string | null;
  html_url?: string | null;
  clone_url?: string | null;
  owner: GiteaOwner;
}

interface GiteaLabel {
  id: number;
  name: string;
}

interface GiteaIssue {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  state: string;
  labels?: GiteaLabel[] | null;
  user: GiteaUser;
  created_at: string;
  updated_at: string;
}

interface GiteaPullRequest {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  state: string;
  labels?: GiteaLabel[] | null;
  user: GiteaUser;
  created_at: string;
  updated_at: string;
  head?: { ref?: string | null; label?: string | null } | null;
  base?: { ref?: string | null; label?: string | null } | null;
  merged?: boolean;
  draft?: boolean;
}

interface GiteaComment {
  id: number;
  body?: string | null;
  user?: GiteaUser | null;
  html_url?: string | null;
  issue_url?: string | null;
  pull_request_url?: string | null;
  created_at: string;
  updated_at: string;
}

interface GiteaRawTypes extends ProviderRawTypes {
  owner: GiteaOwner;
  repository: GiteaRepository;
  issue: GiteaIssue;
  pullRequest: GiteaPullRequest;
  user: GiteaUser;
  thread: GiteaReviewThread;
  comment: GiteaComment;
}

interface GiteaPullReview {
  id: number;
  comments_count?: number;
}

interface GiteaPullReviewComment {
  id: number;
  body: string;
  user?: GiteaUser | null;
  html_url?: string | null;
  created_at: string;
  path?: string | null;
  position?: number | null;
  original_position?: number | null;
  resolver?: GiteaUser | null;
}

interface GiteaReviewThread {
  comments: GiteaPullReviewComment[];
}

// -- Pagination helper --

function buildPageResult<TRaw, T>(
  data: TRaw[],
  headers: Headers,
  mapper: (raw: TRaw) => T,
): PageResult<T> {
  const items = data.map(mapper);
  const links = parseLinkHeader(headers.get("Link"));
  const hasNextPage = !!links.next;

  let nextPage: number | undefined;
  if (links.next) {
    try {
      const url = new URL(links.next);
      const page = url.searchParams.get("page");
      if (page) nextPage = parseInt(page, 10);
    } catch {
      // malformed URL, ignore
    }
  }

  return { items, hasNextPage, nextPage };
}

/**
 * Build query params for Gitea list endpoints.
 * Uses `limit` instead of `per_page` (key Gitea difference).
 */
function buildListQuery(options?: ListOptions): Record<string, string> {
  const query: Record<string, string> = {};
  if (options?.page) query.page = String(options.page);
  if (options?.perPage) query.limit = String(options.perPage);
  if (options?.state) query.state = options.state;
  return query;
}

// -- Provider --

const PLATFORM = "gitea";

/**
 * Gitea/Forgejo provider implementation.
 */
export class GiteaProvider extends Provider<GiteaRawTypes> {
  private client: HttpClient;

  /**
   * Create a Gitea/Forgejo provider.
   *
   * @param config Provider configuration. `baseURL` defaults to `https://gitea.com/api/v1`.
   */
  constructor(config: ProviderConfig) {
    super();
    const baseURL = normalizeApiBaseURL(config.baseURL, "https://gitea.com/api/v1", "/api/v1");

    this.client = createHttpClient({
      baseURL,
      token: config.token ?? "",
      tokenHeader: "Authorization",
      tokenPrefix: "token ",
    });
  }

  protected override mapOwner(raw: GiteaOwner): Owner {
    return {
      login: raw.login,
      avatarUrl: raw.avatar_url ?? "",
    };
  }

  protected override mapRepository(raw: GiteaRepository): Repository {
    return {
      id: String(raw.id),
      name: raw.name,
      fullName: raw.full_name,
      description: raw.description ?? "",
      private: raw.private,
      defaultBranch: raw.default_branch ?? "main",
      url: raw.html_url ?? "",
      cloneUrl: raw.clone_url ?? "",
      owner: this.mapOwner(raw.owner),
    };
  }

  protected override mapIssue(raw: GiteaIssue): Issue {
    return {
      id: String(raw.id),
      number: raw.number,
      title: raw.title,
      body: raw.body ?? "",
      state: raw.state === "open" ? "open" : "closed",
      labels: raw.labels?.map((label) => label.name) ?? [],
      author: { login: raw.user.login },
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  }

  protected override mapPullRequest(raw: GiteaPullRequest): PullRequest {
    return {
      id: String(raw.id),
      number: raw.number,
      title: raw.title,
      body: raw.body ?? "",
      state: raw.state === "open" ? "open" : "closed",
      labels: raw.labels?.map((label) => label.name) ?? [],
      author: { login: raw.user.login },
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      sourceBranch: raw.head?.ref ?? "",
      targetBranch: raw.base?.ref ?? "",
      merged: raw.merged ?? false,
      draft: raw.draft ?? false,
    };
  }

  /**
   * Gitea has no company field on its user, so `company` is always empty.
   */
  protected override mapUser(raw: GiteaUser): User {
    return {
      id: String(raw.id),
      login: raw.login,
      name: raw.full_name ?? "",
      email: raw.email ?? "",
      avatarUrl: raw.avatar_url ?? "",
      isAdmin: raw.is_admin ?? false,
      bio: raw.description ?? "",
      company: "",
      location: raw.location ?? "",
      website: raw.website ?? "",
      followers: raw.followers_count ?? 0,
      following: raw.following_count ?? 0,
      createdAt: raw.created ?? "",
      url: raw.html_url ?? "",
    };
  }

  protected override mapComment(raw: GiteaComment): Comment {
    return {
      id: String(raw.id),
      body: raw.body ?? "",
      author: { login: raw.user?.login ?? "" },
      url: raw.html_url ?? "",
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  }

  protected override mapThread(raw: GiteaReviewThread): Thread {
    const first = raw.comments[0];
    // Gitea fills exactly one side: `position` is the new-file line,
    // `original_position` the old-file line, and the unused one serializes as 0.
    // Its internal `Invalidated` flag is not part of the API, so an outdated
    // comment is indistinguishable from a current one here.
    const position = first?.position ?? 0;
    const originalPosition = first?.original_position ?? 0;
    const line = position > 0 ? position : originalPosition;
    return {
      id: first === undefined ? "" : String(first.id),
      isResolved: raw.comments.some((comment) => comment.resolver != null),
      isOutdated: false,
      path: first?.path ?? "",
      line: line > 0 ? line : null,
      startLine: null,
      comments: raw.comments.map((comment) => ({
        id: String(comment.id),
        body: comment.body,
        author: { login: comment.user?.login ?? "" },
        url: comment.html_url ?? "",
        createdAt: comment.created_at,
      })),
    };
  }

  protected override async listRepos(
    owner: string,
    options?: ListOptions,
  ): Promise<PageResult<Repository>> {
    try {
      const query = buildListQuery(options);
      const { data, headers } = await rawFetch<GiteaRepository[]>(
        this.client,
        `/users/${encodePathSegment(owner)}/repos`,
        { query },
      );
      return buildPageResult(data ?? [], headers, (raw) => this.mapRepository(raw));
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getRepo(owner: string, repo: string): Promise<Repository> {
    try {
      return this.mapRepository(
        await cachedFetch<GiteaRepository>(
          this.client,
          `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`,
        ),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async listIssues(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<Issue>> {
    try {
      const query = buildListQuery(options);
      query.type = "issues";
      const { data, headers } = await rawFetch<GiteaIssue[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues`,
        { query },
      );
      return buildPageResult(data ?? [], headers, (raw) => this.mapIssue(raw));
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getIssue(owner: string, repo: string, number: number): Promise<Issue> {
    try {
      return this.mapIssue(
        await cachedFetch<GiteaIssue>(
          this.client,
          `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues/${encodePathSegment(number)}`,
        ),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async createIssue(
    owner: string,
    repo: string,
    input: CreateIssueInput,
  ): Promise<Issue> {
    try {
      const body: Record<string, unknown> = {
        title: input.title,
        body: input.body,
      };
      if (input.labels?.length) {
        body.labels = input.labels;
      }
      return this.mapIssue(
        await this.client<GiteaIssue>(
          `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues`,
          {
            method: "POST",
            body,
          },
        ),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async listPullRequests(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<PullRequest>> {
    try {
      const query = buildListQuery(options);
      const { data, headers } = await rawFetch<GiteaPullRequest[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls`,
        { query },
      );
      return buildPageResult(data ?? [], headers, (raw) => this.mapPullRequest(raw));
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getPullRequest(
    owner: string,
    repo: string,
    number: number,
  ): Promise<PullRequest> {
    try {
      return this.mapPullRequest(
        await cachedFetch<GiteaPullRequest>(
          this.client,
          `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}`,
        ),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async createPullRequest(
    owner: string,
    repo: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequest> {
    try {
      const body: Record<string, unknown> = {
        title: input.title,
        body: input.body,
        head: input.sourceBranch,
        base: input.targetBranch,
      };
      if (input.draft !== undefined) {
        body.draft = input.draft;
      }
      return this.mapPullRequest(
        await this.client<GiteaPullRequest>(
          `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls`,
          {
            method: "POST",
            body,
          },
        ),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  // --- Comments ---

  /**
   * The issue-comments route ignores page and limit and answers with the whole
   * discussion, so the requested page is cut locally after an id sort that
   * pins the documented oldest-first order. The paging params still go out and
   * the Link header is still read, so a host that does paginate this route
   * stays correct and is only walked one comment past the requested slice
   * instead of to the end; a pending next link then answers hasNextPage.
   */
  protected override async listIssueComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>> {
    try {
      const perPage = options?.perPage ?? 30;
      const page = options?.page ?? 1;
      const start = (page - 1) * perPage;
      const comments: GiteaComment[] = [];
      let remotePage = 1;
      let hasMore = true;
      while (hasMore && comments.length <= start + perPage) {
        const { data, headers } = await rawFetch<GiteaComment[]>(
          this.client,
          `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues/${encodePathSegment(number)}/comments`,
          { query: { page: String(remotePage), limit: "50" } },
        );
        const batch = data ?? [];
        if (batch.length === 0) {
          hasMore = false;
          break;
        }
        comments.push(...batch);
        hasMore = !!parseLinkHeader(headers.get("Link")).next;
        remotePage += 1;
      }
      comments.sort((left, right) => left.id - right.id);

      const items = comments.slice(start, start + perPage).map((raw) => this.mapComment(raw));
      const hasNextPage = hasMore || start + items.length < comments.length;
      return {
        items,
        hasNextPage,
        nextPage: hasNextPage ? page + 1 : undefined,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /** Gitea indexes pull requests as issues, so their discussion shares this route. */
  protected override async listPullRequestComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>> {
    return this.listIssueComments(owner, repo, number, options);
  }

  /**
   * Gitea keys discussion comments by id alone, so the endpoint cannot scope
   * the read. The comment names its issue or pull request by URL and issues
   * share the index space with pulls, so either one matching the requested
   * number passes; anything else answers 404 like it does on GitLab. A
   * payload carrying neither URL skips the check, because rejecting it would
   * fail every read against a server that omits the association.
   */
  protected override async getIssueComment(
    owner: string,
    repo: string,
    number: number,
    commentId: string,
  ): Promise<Comment> {
    try {
      const data = await cachedFetch<GiteaComment>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues/comments/${encodePathSegment(commentId)}`,
      );
      const association = data.issue_url || data.pull_request_url;
      if (
        association &&
        !association.endsWith(`/issues/${number}`) &&
        !association.endsWith(`/pulls/${number}`)
      ) {
        throw new NotFoundError(`Comment not found: ${commentId}`, PLATFORM);
      }
      return this.mapComment(data);
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /** Pull-request discussion comments live on the issues endpoint too. */
  protected override async getPullRequestComment(
    owner: string,
    repo: string,
    number: number,
    commentId: string,
  ): Promise<Comment> {
    return this.getIssueComment(owner, repo, number, commentId);
  }

  protected override async getUser(username: string): Promise<User> {
    try {
      return this.mapUser(
        await cachedFetch<GiteaUser>(this.client, `/users/${encodePathSegment(username)}`),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getAuthenticatedUser(): Promise<User> {
    try {
      return this.mapUser(await cachedFetch<GiteaUser>(this.client, "/user"));
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  // --- Threads ---

  protected override async listThreads(
    owner: string,
    repo: string,
    number: number,
    options?: ListThreadOptions,
  ): Promise<PageResult<Thread>> {
    try {
      const threads = this.filterThreadsByState(
        (await this.groupedReviewThreads(owner, repo, number)).map((thread) =>
          this.mapThread(thread),
        ),
        options?.state,
      );
      const perPage = options?.perPage ?? 30;
      const page = options?.page ?? 1;
      const start = (page - 1) * perPage;
      const items = threads.slice(start, start + perPage);
      const hasNextPage = start + items.length < threads.length;
      return {
        items,
        hasNextPage,
        nextPage: hasNextPage ? page + 1 : undefined,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread> {
    try {
      return this.mapThread(await this.findReviewThread(owner, repo, number, threadId));
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /**
   * Gitea has no parent id on review comments, so every comment is its own
   * thread and the thread id is that comment id. Mutations address the comment
   * directly instead of rescanning every review on the pull request.
   */
  protected override async replyToThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
    input: ReplyThreadInput,
  ): Promise<ThreadComment> {
    try {
      const comment = await this.client<GiteaPullReviewComment>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}/comments/${encodePathSegment(threadId)}/replies`,
        {
          method: "POST",
          body: { body: input.body },
        },
      );
      return {
        id: String(comment.id),
        body: comment.body,
        author: { login: comment.user?.login ?? "" },
        url: comment.html_url ?? "",
        createdAt: comment.created_at,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async resolveThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread> {
    return this.setReviewThreadResolved(owner, repo, number, threadId, true);
  }

  protected override async unresolveThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread> {
    return this.setReviewThreadResolved(owner, repo, number, threadId, false);
  }

  private async setReviewThreadResolved(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
    resolved: boolean,
  ): Promise<Thread> {
    try {
      // Unlike the reply endpoint, resolve/unresolve is scoped only by repository
      // and comment id, so the comment must be confirmed to sit on this pull
      // request before it is mutated.
      const thread = await this.findReviewThread(owner, repo, number, threadId);
      const action = resolved ? "resolve" : "unresolve";
      await this.client(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/comments/${encodePathSegment(threadId)}/${action}`,
        { method: "POST" },
      );
      return { ...this.mapThread(thread), isResolved: resolved };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  private async findReviewThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<GiteaReviewThread> {
    const thread = (await this.groupedReviewThreads(owner, repo, number)).find(
      (candidate) => String(candidate.comments[0]?.id) === threadId,
    );
    if (!thread) {
      throw new NotFoundError(
        `Resource not found: thread ${threadId} on ${owner}/${repo}#${number}`,
        PLATFORM,
      );
    }
    return thread;
  }

  private async reviewComments(
    owner: string,
    repo: string,
    number: number,
    reviewId: number,
  ): Promise<GiteaPullReviewComment[]> {
    const comments: GiteaPullReviewComment[] = [];
    let page = 1;
    let hasNextPage = true;
    while (hasNextPage) {
      const { data, headers } = await rawFetch<GiteaPullReviewComment[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}/reviews/${encodePathSegment(reviewId)}/comments`,
        { query: { page: String(page), limit: "50" } },
      );
      const batch = data ?? [];
      if (batch.length === 0) {
        break;
      }
      comments.push(...batch);
      hasNextPage = !!parseLinkHeader(headers.get("Link")).next;
      page += 1;
    }
    return comments;
  }

  private async groupedReviewThreads(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GiteaReviewThread[]> {
    const comments: GiteaPullReviewComment[] = [];
    let page = 1;
    let hasNextPage = true;
    while (hasNextPage) {
      const { data, headers } = await rawFetch<GiteaPullReview[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}/reviews`,
        { query: { page: String(page), limit: "50" } },
      );
      const reviews = data ?? [];
      if (reviews.length === 0) {
        break;
      }
      for (const review of reviews) {
        if (review.comments_count === 0) {
          continue;
        }
        comments.push(...(await this.reviewComments(owner, repo, number, review.id)));
      }
      hasNextPage = !!parseLinkHeader(headers.get("Link")).next;
      page += 1;
    }

    return comments
      .slice()
      .sort((left, right) => left.id - right.id)
      .map((comment) => ({ comments: [comment] }));
  }
}

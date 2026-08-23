/**
 * GitLab provider implementation
 * Maps GitLab API v4 to the unified Provider base class
 *
 * Key differences from GitHub:
 * - Uses Private-Token header (not Authorization)
 * - Merge Requests instead of Pull Requests
 * - path_with_namespace instead of full_name
 * - iid (project-scoped) vs id (global) for issues/MRs
 * - x-next-page header for pagination (not Link header)
 * - Most endpoints require numeric project ID
 */

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
  IssueState,
  ReplyThreadInput,
  Thread,
  ThreadComment,
} from "../types.ts";
import { createHttpClient, rawFetch, type HttpClient, type RawFetchResult } from "../http.ts";
import { cachedFetch, invalidateCache } from "../cache.ts";
import { normalizeError, NotFoundError } from "../errors.ts";
import { encodePathSegment, normalizeApiBaseURL } from "./base-url.ts";

// GitLab API response types (internal)

interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  description: string | null;
  visibility: string;
  default_branch: string | null;
  web_url: string;
  http_url_to_repo: string;
  namespace: {
    path: string;
    avatar_url: string | null;
  };
  owner?: {
    username: string;
    avatar_url: string | null;
  };
}

interface GitLabIssue {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: string;
  labels: string[];
  author: {
    username: string;
  };
  created_at: string;
  updated_at: string;
}

interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: string;
  labels: string[];
  author: {
    username: string;
  };
  created_at: string;
  updated_at: string;
  source_branch: string;
  target_branch: string;
  merged_at: string | null;
  draft: boolean;
}

interface GitLabUser {
  id: number;
  username: string;
  name: string;
  email?: string | null;
  public_email?: string | null;
  avatar_url: string | null;
  is_admin?: boolean;
  bio?: string | null;
  organization?: string | null;
  location?: string | null;
  website_url?: string | null;
  followers?: number;
  following?: number;
  created_at?: string;
  web_url?: string;
}

interface GitLabNote {
  id: number;
  type: string | null;
  body: string;
  author: {
    username: string;
  };
  created_at: string;
  updated_at: string;
  system: boolean;
}

interface GitLabRawTypes extends ProviderRawTypes {
  owner: GitLabProject;
  repository: GitLabProject;
  issue: GitLabIssue;
  pullRequest: GitLabMergeRequest;
  user: GitLabUser;
  thread: GitLabDiscussion;
  comment: GitLabNote;
}

interface GitLabDiscussionPosition {
  new_path?: string | null;
  old_path?: string | null;
  new_line?: number | null;
  old_line?: number | null;
  line_range?: {
    start?: { new_line?: number | null; old_line?: number | null };
  };
}

interface GitLabDiscussionNote {
  id: number;
  body: string;
  author: { username: string };
  created_at: string;
  system: boolean;
  resolvable?: boolean;
  resolved?: boolean;
  position?: GitLabDiscussionPosition | null;
}

interface GitLabDiscussion {
  id: string;
  individual_note: boolean;
  notes: GitLabDiscussionNote[];
}

/**
 * Encode a GitLab namespace path while preserving nested group boundaries.
 */
function encodeNamespacePath(namespace: string): string {
  return namespace.split("/").map(encodePathSegment).join("%2F");
}

/**
 * Encode owner/repo as GitLab project path for API requests.
 * GitLab requires URL-encoding of the full path (e.g., "owner/repo" → "owner%2Frepo").
 */
function encodeProjectPath(owner: string, repo: string): string {
  return `${encodeNamespacePath(owner)}%2F${encodePathSegment(repo)}`;
}

const DEFAULT_PROJECT_ID_CACHE_MAX = 500;
const DEFAULT_PROJECT_ID_CACHE_TTL = 300000;

interface ProjectIdCacheEntry {
  id: number;
  cachedAt: number;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}

/**
 * GitLab provider — implements the unified Provider base class for GitLab API v4.
 *
 * Handles the fundamental differences between GitLab and GitHub:
 * - Private-Token authentication
 * - Merge Requests mapped to PullRequests
 * - Numeric project IDs required for most endpoints
 * - x-next-page pagination headers
 */
export class GitLabProvider extends Provider<GitLabRawTypes> {
  private client: HttpClient;
  private projectIdCache = new Map<string, ProjectIdCacheEntry>();
  private readonly projectIdCacheMax: number;
  private readonly projectIdCacheTtl: number;

  constructor(config: ProviderConfig) {
    super();
    const baseURL = normalizeApiBaseURL(config.baseURL, "https://gitlab.com/api/v4", "/api/v4");

    this.client = createHttpClient({
      baseURL,
      token: config.token ?? "",
      tokenHeader: "Private-Token",
      tokenPrefix: "",
    });

    this.projectIdCacheMax = normalizePositiveInteger(
      config.gitlab?.projectIdCacheMax,
      DEFAULT_PROJECT_ID_CACHE_MAX,
    );
    this.projectIdCacheTtl = normalizePositiveInteger(
      config.gitlab?.projectIdCacheTtl,
      DEFAULT_PROJECT_ID_CACHE_TTL,
    );
  }

  protected override mapOwner(raw: GitLabProject): Owner {
    if (raw.owner) {
      return {
        login: raw.owner.username,
        avatarUrl: raw.owner.avatar_url ?? "",
      };
    }
    return {
      login: raw.namespace.path,
      avatarUrl: raw.namespace.avatar_url ?? "",
    };
  }

  protected override mapRepository(raw: GitLabProject): Repository {
    return {
      id: String(raw.id),
      name: raw.name,
      fullName: raw.path_with_namespace,
      description: raw.description ?? "",
      private: raw.visibility === "private",
      defaultBranch: raw.default_branch ?? "main",
      url: raw.web_url,
      cloneUrl: raw.http_url_to_repo,
      owner: this.mapOwner(raw),
    };
  }

  private mapGitLabState(state: string): IssueState {
    return state === "closed" || state === "merged" ? "closed" : "open";
  }

  protected override mapIssue(raw: GitLabIssue): Issue {
    return {
      id: String(raw.id),
      number: raw.iid,
      title: raw.title,
      body: raw.description ?? "",
      state: this.mapGitLabState(raw.state),
      labels: raw.labels,
      author: { login: raw.author.username },
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  }

  protected override mapPullRequest(raw: GitLabMergeRequest): PullRequest {
    return {
      id: String(raw.id),
      number: raw.iid,
      title: raw.title,
      body: raw.description ?? "",
      state: this.mapGitLabState(raw.state),
      labels: raw.labels,
      author: { login: raw.author.username },
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      sourceBranch: raw.source_branch,
      targetBranch: raw.target_branch,
      merged: raw.merged_at !== null,
      draft: raw.draft,
    };
  }

  protected override mapUser(raw: GitLabUser): User {
    return {
      id: String(raw.id),
      login: raw.username,
      name: raw.name,
      email: raw.email || raw.public_email || "",
      avatarUrl: raw.avatar_url ?? "",
      isAdmin: raw.is_admin ?? false,
      bio: raw.bio ?? "",
      company: raw.organization ?? "",
      location: raw.location ?? "",
      website: raw.website_url ?? "",
      followers: raw.followers ?? 0,
      following: raw.following ?? 0,
      createdAt: raw.created_at ?? "",
      url: raw.web_url ?? "",
    };
  }

  protected override mapThread(raw: GitLabDiscussion): Thread {
    const notes = raw.notes.filter((note) => !note.system);
    const firstNote = notes[0];
    const resolvable = notes.find((note) => note.resolvable);
    const position = firstNote?.position;
    return {
      id: raw.id,
      isResolved: resolvable?.resolved === true,
      isOutdated: false,
      path: position?.new_path ?? position?.old_path ?? "",
      line: position?.new_line ?? position?.old_line ?? null,
      startLine:
        position?.line_range?.start?.new_line ?? position?.line_range?.start?.old_line ?? null,
      comments: notes.map((note) => ({
        id: String(note.id),
        body: note.body,
        author: { login: note.author.username },
        url: "",
        createdAt: note.created_at,
      })),
    };
  }

  protected override mapComment(raw: GitLabNote): Comment {
    return {
      id: String(raw.id),
      body: raw.body,
      author: { login: raw.author.username },
      url: "",
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  }

  private mapStateFilter(state?: IssueState | "all"): string | undefined {
    if (!state || state === "all") return undefined;
    return state === "open" ? "opened" : state;
  }

  private getCachedProjectId(key: string): number | undefined {
    const entry = this.projectIdCache.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() - entry.cachedAt > this.projectIdCacheTtl) {
      this.projectIdCache.delete(key);
      return undefined;
    }

    this.projectIdCache.delete(key);
    this.projectIdCache.set(key, entry);
    return entry.id;
  }

  private setCachedProjectId(key: string, projectId: number): void {
    this.pruneExpiredProjectIdCache();

    if (this.projectIdCache.size >= this.projectIdCacheMax && !this.projectIdCache.has(key)) {
      const oldestKey = this.projectIdCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.projectIdCache.delete(oldestKey);
      }
    }

    this.projectIdCache.delete(key);
    this.projectIdCache.set(key, {
      id: projectId,
      cachedAt: Date.now(),
    });
  }

  private pruneExpiredProjectIdCache(): void {
    const now = Date.now();

    for (const [key, entry] of this.projectIdCache.entries()) {
      if (now - entry.cachedAt > this.projectIdCacheTtl) {
        this.projectIdCache.delete(key);
      }
    }
  }

  /**
   * Resolve a project's numeric ID from owner/repo path.
   * Caches the result to avoid repeated lookups.
   */
  private async resolveProjectId(owner: string, repo: string): Promise<number> {
    const key = `${owner}/${repo}`;
    const cached = this.getCachedProjectId(key);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const encoded = encodeProjectPath(owner, repo);
      const project = await this.client<GitLabProject>(`/projects/${encoded}`);
      this.setCachedProjectId(key, project.id);
      return project.id;
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  /**
   * Parse GitLab pagination headers into PageResult metadata.
   */
  private parsePagination<T>(items: T[], headers: Headers): PageResult<T> {
    const nextPage = headers.get("x-next-page");
    const total = headers.get("x-total");

    return {
      items,
      totalCount: total ? parseInt(total, 10) : undefined,
      hasNextPage: nextPage !== null && nextPage !== "",
      nextPage: nextPage !== null && nextPage !== "" ? parseInt(nextPage, 10) : undefined,
    };
  }

  // --- Repos ---

  protected override async listRepos(
    owner: string,
    options?: ListOptions,
  ): Promise<PageResult<Repository>> {
    try {
      const encodedOwner = encodeNamespacePath(owner);
      // Try user projects first, fall back to group projects
      let response: RawFetchResult<GitLabProject[]>;
      try {
        response = await rawFetch<GitLabProject[]>(this.client, `/users/${encodedOwner}/projects`, {
          query: {
            page: options?.page ?? 1,
            per_page: options?.perPage ?? 30,
          },
        });
      } catch (error: unknown) {
        const normalized = normalizeError(error, "gitlab");
        if (normalized.status !== 404) {
          throw normalized;
        }

        response = await rawFetch<GitLabProject[]>(
          this.client,
          `/groups/${encodedOwner}/projects`,
          {
            query: {
              page: options?.page ?? 1,
              per_page: options?.perPage ?? 30,
            },
          },
        );
      }

      const repos = (response.data ?? []).map((raw) => this.mapRepository(raw));
      return this.parsePagination(repos, response.headers);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  protected override async getRepo(owner: string, repo: string): Promise<Repository> {
    try {
      const encoded = encodeProjectPath(owner, repo);
      const project = await cachedFetch<GitLabProject>(this.client, `/projects/${encoded}`);
      // Cache project ID while we have it
      this.setCachedProjectId(`${owner}/${repo}`, project.id);
      return this.mapRepository(project);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  // --- Issues ---

  protected override async listIssues(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<Issue>> {
    try {
      const projectId = await this.resolveProjectId(owner, repo);
      const query: Record<string, string | number> = {
        page: options?.page ?? 1,
        per_page: options?.perPage ?? 30,
      };

      const stateFilter = this.mapStateFilter(options?.state);
      if (stateFilter) {
        query.state = stateFilter;
      }

      const response = await rawFetch<GitLabIssue[]>(this.client, `/projects/${projectId}/issues`, {
        query,
      });

      const issues = (response.data ?? []).map((raw) => this.mapIssue(raw));
      return this.parsePagination(issues, response.headers);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  protected override async getIssue(owner: string, repo: string, iid: number): Promise<Issue> {
    try {
      const projectId = await this.resolveProjectId(owner, repo);
      const issue = await cachedFetch<GitLabIssue>(
        this.client,
        `/projects/${projectId}/issues/${encodePathSegment(iid)}`,
      );
      return this.mapIssue(issue);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  protected override async createIssue(
    owner: string,
    repo: string,
    input: CreateIssueInput,
  ): Promise<Issue> {
    try {
      const projectId = await this.resolveProjectId(owner, repo);
      const issue = await this.client<GitLabIssue>(`/projects/${projectId}/issues`, {
        method: "POST",
        body: {
          title: input.title,
          description: input.body,
          labels: input.labels?.join(","),
        },
      });
      return this.mapIssue(issue);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  // --- Merge Requests (mapped to Pull Requests) ---

  protected override async listPullRequests(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<PullRequest>> {
    try {
      const projectId = await this.resolveProjectId(owner, repo);
      const query: Record<string, string | number> = {
        page: options?.page ?? 1,
        per_page: options?.perPage ?? 30,
      };

      const stateFilter = this.mapStateFilter(options?.state);
      if (stateFilter) {
        query.state = stateFilter;
      }

      const response = await rawFetch<GitLabMergeRequest[]>(
        this.client,
        `/projects/${projectId}/merge_requests`,
        { query },
      );

      const prs = (response.data ?? []).map((raw) => this.mapPullRequest(raw));
      return this.parsePagination(prs, response.headers);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  protected override async getPullRequest(
    owner: string,
    repo: string,
    iid: number,
  ): Promise<PullRequest> {
    try {
      const projectId = await this.resolveProjectId(owner, repo);
      const mr = await cachedFetch<GitLabMergeRequest>(
        this.client,
        `/projects/${projectId}/merge_requests/${encodePathSegment(iid)}`,
      );
      return this.mapPullRequest(mr);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  protected override async createPullRequest(
    owner: string,
    repo: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequest> {
    try {
      const projectId = await this.resolveProjectId(owner, repo);
      const body: Record<string, unknown> = {
        title: input.title,
        description: input.body,
        source_branch: input.sourceBranch,
        target_branch: input.targetBranch,
      };

      if (input.draft !== undefined) {
        body.draft = input.draft;
      }

      const mr = await this.client<GitLabMergeRequest>(`/projects/${projectId}/merge_requests`, {
        method: "POST",
        body,
      });
      return this.mapPullRequest(mr);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  // --- Comments ---

  protected override async listIssueComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>> {
    return this.listNotes(owner, repo, "issues", number, options);
  }

  protected override async listPullRequestComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>> {
    return this.listNotes(owner, repo, "merge_requests", number, options);
  }

  /**
   * GitLab lists notes newest first by default while GitHub and Gitea list
   * discussion comments oldest first, so the ascending sort is pinned in the
   * query. Two note kinds are dropped: system notes record label and state
   * churn rather than discussion, and DiffNotes, along with their pre-position
   * LegacyDiffNote predecessors, are inline code-review comments that belong
   * to the thread surface, which GitHub's issue-comments endpoint never mixes
   * in either. Replies inside a diff discussion carry the root's type, so the
   * type check drops the whole discussion. A short page whose hasNextPage is
   * true therefore just means keep paging. That filtering is also why
   * totalCount is withheld: x-total counts the dropped notes too, so it does
   * not describe the returned items.
   */
  private async listNotes(
    owner: string,
    repo: string,
    resource: "issues" | "merge_requests",
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>> {
    try {
      const projectId = await this.resolveProjectId(owner, repo);
      const response = await rawFetch<GitLabNote[]>(
        this.client,
        `/projects/${projectId}/${resource}/${encodePathSegment(number)}/notes`,
        {
          query: {
            page: options?.page ?? 1,
            per_page: options?.perPage ?? 30,
            order_by: "created_at",
            sort: "asc",
          },
        },
      );

      const notes = (response.data ?? []).filter(
        (note) => !note.system && note.type !== "DiffNote" && note.type !== "LegacyDiffNote",
      );
      const page = this.parsePagination(
        notes.map((raw) => this.mapComment(raw)),
        response.headers,
      );
      return { ...page, totalCount: undefined };
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  // --- Users ---

  /**
   * GitLab has no direct /users/:username endpoint and the username search
   * returns only a basic subset of fields, so the lookup resolves the id
   * first and then reads the full profile.
   */
  protected override async getUser(username: string): Promise<User> {
    try {
      const users = await cachedFetch<GitLabUser[]>(this.client, "/users", { query: { username } });
      const match = users[0];

      if (match === undefined) {
        throw new NotFoundError(`User not found: ${username}`, "gitlab");
      }

      return this.mapUser(await cachedFetch<GitLabUser>(this.client, `/users/${match.id}`));
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  protected override async getAuthenticatedUser(): Promise<User> {
    try {
      const user = await cachedFetch<GitLabUser>(this.client, "/user");
      return this.mapUser(user);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
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
      const projectId = await this.resolveProjectId(owner, repo);
      const perPage = options?.perPage ?? 30;
      const page = options?.page ?? 1;
      const skip = (page - 1) * perPage;
      const matched: Thread[] = [];
      let remotePage = 1;
      let hasMore = true;

      // Scan one match past the page: with a state filter, a full page says
      // nothing about whether any later thread still matches.
      while (hasMore && matched.length <= skip + perPage) {
        const response = await rawFetch<GitLabDiscussion[]>(
          this.client,
          `/projects/${projectId}/merge_requests/${encodePathSegment(number)}/discussions`,
          {
            query: {
              page: remotePage,
              per_page: 50,
            },
          },
        );
        const batch = response.data ?? [];
        if (batch.length === 0) {
          hasMore = false;
          continue;
        }
        matched.push(
          ...this.filterThreadsByState(
            batch
              .filter((discussion) => discussion.notes.some((note) => note.resolvable))
              .map((discussion) => this.mapThread(discussion)),
            options?.state,
          ),
        );
        const nextPage = response.headers.get("x-next-page");
        hasMore = nextPage !== null && nextPage !== "";
        remotePage += 1;
      }

      const items = matched.slice(skip, skip + perPage);
      const hasNextPage = matched.length > skip + perPage;
      return {
        items,
        hasNextPage,
        nextPage: hasNextPage ? page + 1 : undefined,
      };
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  protected override async getThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread> {
    try {
      const discussion = await this.fetchDiscussion(owner, repo, number, threadId);
      return this.mapThread(discussion);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  protected override async replyToThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
    input: ReplyThreadInput,
  ): Promise<ThreadComment> {
    try {
      const url = await this.discussionUrl(owner, repo, number, threadId);
      const note = await this.client<GitLabDiscussionNote>(`${url}/notes`, {
        method: "POST",
        body: { body: input.body },
      });
      await this.dropCachedDiscussion(url);
      return {
        id: String(note.id),
        body: note.body,
        author: { login: note.author.username },
        url: "",
        createdAt: note.created_at,
      };
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  protected override async resolveThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread> {
    return this.setDiscussionResolved(owner, repo, number, threadId, true);
  }

  protected override async unresolveThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread> {
    return this.setDiscussionResolved(owner, repo, number, threadId, false);
  }

  /**
   * Cache eviction must never fail a mutation the platform already accepted:
   * a rejecting storage backend would surface as a failed reply and invite a
   * duplicate retry.
   */
  private async dropCachedDiscussion(url: string): Promise<void> {
    try {
      await invalidateCache(this.client, url);
    } catch (error) {
      console.warn(`[forges] Could not invalidate cached discussion ${url}: ${String(error)}`);
    }
  }

  private async discussionUrl(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<string> {
    const projectId = await this.resolveProjectId(owner, repo);
    return `/projects/${projectId}/merge_requests/${encodePathSegment(number)}/discussions/${encodePathSegment(threadId)}`;
  }

  private async fetchDiscussion(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<GitLabDiscussion> {
    return cachedFetch<GitLabDiscussion>(
      this.client,
      await this.discussionUrl(owner, repo, number, threadId),
    );
  }

  private async setDiscussionResolved(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
    resolved: boolean,
  ): Promise<Thread> {
    try {
      const url = await this.discussionUrl(owner, repo, number, threadId);
      const discussion = await this.client<GitLabDiscussion>(url, {
        method: "PUT",
        body: { resolved },
      });
      await this.dropCachedDiscussion(url);
      return this.mapThread(discussion);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }
}

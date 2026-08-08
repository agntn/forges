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
  CreateIssueInput,
  CreatePullRequestInput,
  IssueState,
} from "../types.ts";
import { createHttpClient, rawFetch, type HttpClient, type RawFetchResult } from "../http.ts";
import { cachedFetch } from "../cache.ts";
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
  email: string;
  avatar_url: string | null;
  is_admin?: boolean;
}

interface GitLabRawTypes extends ProviderRawTypes {
  owner: GitLabProject;
  repository: GitLabProject;
  issue: GitLabIssue;
  pullRequest: GitLabMergeRequest;
  user: GitLabUser;
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
      email: raw.email ?? "",
      avatarUrl: raw.avatar_url ?? "",
      isAdmin: raw.is_admin ?? false,
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

  // --- Users ---

  protected override async getUser(username: string): Promise<User> {
    try {
      // GitLab doesn't have a direct /users/:username endpoint.
      // Instead, search by username and take the first result.
      const users = await cachedFetch<GitLabUser[]>(this.client, "/users", { query: { username } });
      const user = users[0];

      if (user === undefined) {
        throw new NotFoundError(`User not found: ${username}`, "gitlab");
      }

      return this.mapUser(user);
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
}

/**
 * GitLab provider implementation
 * Maps GitLab API v4 to the unified Provider interface
 *
 * Key differences from GitHub:
 * - Uses Private-Token header (not Authorization)
 * - Merge Requests instead of Pull Requests
 * - path_with_namespace instead of full_name
 * - iid (project-scoped) vs id (global) for issues/MRs
 * - x-next-page header for pagination (not Link header)
 * - Most endpoints require numeric project ID
 */

import type {
  Provider,
  ProviderConfig,
  RepositoryResource,
  IssueResource,
  PullRequestResource,
  UserResource,
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
} from "../types.js";
import { createHttpClient, rawFetch } from "../http.js";
import { cachedFetch } from "../cache.js";
import { normalizeError, NotFoundError } from "../errors.js";
import { normalizeApiBaseURL } from "./base-url.js";

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

// Mappers: GitLab → Unified

function mapOwner(project: GitLabProject): Owner {
  if (project.owner) {
    return {
      login: project.owner.username,
      avatarUrl: project.owner.avatar_url ?? "",
    };
  }
  return {
    login: project.namespace.path,
    avatarUrl: project.namespace.avatar_url ?? "",
  };
}

function mapRepository(project: GitLabProject): Repository {
  return {
    id: String(project.id),
    name: project.name,
    fullName: project.path_with_namespace,
    description: project.description ?? "",
    private: project.visibility === "private",
    defaultBranch: project.default_branch ?? "main",
    url: project.web_url,
    cloneUrl: project.http_url_to_repo,
    owner: mapOwner(project),
  };
}

function mapGitLabState(state: string): IssueState {
  // GitLab uses 'opened'/'closed'/'merged'
  return state === "closed" || state === "merged" ? "closed" : "open";
}

function mapIssue(issue: GitLabIssue): Issue {
  return {
    id: String(issue.id),
    number: issue.iid,
    title: issue.title,
    body: issue.description ?? "",
    state: mapGitLabState(issue.state),
    labels: issue.labels,
    author: { login: issue.author.username },
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  };
}

function mapMergeRequest(mr: GitLabMergeRequest): PullRequest {
  return {
    id: String(mr.id),
    number: mr.iid,
    title: mr.title,
    body: mr.description ?? "",
    state: mapGitLabState(mr.state),
    labels: mr.labels,
    author: { login: mr.author.username },
    createdAt: mr.created_at,
    updatedAt: mr.updated_at,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
    merged: mr.merged_at !== null,
    draft: mr.draft,
  };
}

function mapUser(user: GitLabUser): User {
  return {
    id: String(user.id),
    login: user.username,
    name: user.name,
    email: user.email ?? "",
    avatarUrl: user.avatar_url ?? "",
    isAdmin: user.is_admin ?? false,
  };
}

// GitLab state filter mapping
function mapStateFilter(state?: IssueState | "all"): string | undefined {
  if (!state || state === "all") return undefined;
  // GitLab uses 'opened' not 'open'
  return state === "open" ? "opened" : state;
}

/**
 * Encode owner/repo as GitLab project path for API requests.
 * GitLab requires URL-encoding of the full path (e.g., "owner/repo" → "owner%2Frepo").
 */
function encodeProjectPath(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
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
 * GitLab provider — implements the unified Provider interface for GitLab API v4.
 *
 * Handles the fundamental differences between GitLab and GitHub:
 * - Private-Token authentication
 * - Merge Requests mapped to PullRequests
 * - Numeric project IDs required for most endpoints
 * - x-next-page pagination headers
 */
export class GitLabProvider implements Provider {
  private client: ReturnType<typeof createHttpClient>;
  private projectIdCache = new Map<string, ProjectIdCacheEntry>();
  private readonly projectIdCacheMax: number;
  private readonly projectIdCacheTtl: number;

  repos: RepositoryResource;
  issues: IssueResource;
  pullRequests: PullRequestResource;
  users: UserResource;

  constructor(config: ProviderConfig) {
    const baseURL = normalizeApiBaseURL(config.baseURL, "https://gitlab.com/api/v4", "/api/v4");

    this.client = createHttpClient({
      baseURL,
      token: config.token ?? "",
      tokenHeader: "Private-Token",
      tokenPrefix: "",
    });

    this.projectIdCacheMax = normalizePositiveInteger(
      config.gitlab?.projectIdCacheMax,
      DEFAULT_PROJECT_ID_CACHE_MAX
    );
    this.projectIdCacheTtl = normalizePositiveInteger(
      config.gitlab?.projectIdCacheTtl,
      DEFAULT_PROJECT_ID_CACHE_TTL
    );

    this.repos = {
      list: (owner, options?) => this.listRepos(owner, options),
      get: (owner, repo) => this.getRepo(owner, repo),
    };

    this.issues = {
      list: (owner, repo, options?) => this.listIssues(owner, repo, options),
      get: (owner, repo, number) => this.getIssue(owner, repo, number),
      create: (owner, repo, input) => this.createIssue(owner, repo, input),
    };

    this.pullRequests = {
      list: (owner, repo, options?) => this.listMergeRequests(owner, repo, options),
      get: (owner, repo, number) => this.getMergeRequest(owner, repo, number),
      create: (owner, repo, input) => this.createMergeRequest(owner, repo, input),
    };

    this.users = {
      get: (username) => this.getUser(username),
      authenticated: () => this.getAuthenticatedUser(),
    };
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

  private async listRepos(owner: string, options?: ListOptions): Promise<PageResult<Repository>> {
    try {
      // Try user projects first, fall back to group projects
      let response: Awaited<ReturnType<typeof rawFetch<GitLabProject[]>>>;
      try {
        response = await rawFetch<GitLabProject[]>(this.client, `/users/${owner}/projects`, {
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

        response = await rawFetch<GitLabProject[]>(this.client, `/groups/${owner}/projects`, {
          query: {
            page: options?.page ?? 1,
            per_page: options?.perPage ?? 30,
          },
        });
      }

      const repos = (response.data ?? []).map(mapRepository);
      return this.parsePagination(repos, response.headers);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  private async getRepo(owner: string, repo: string): Promise<Repository> {
    try {
      const encoded = encodeProjectPath(owner, repo);
      const project = await cachedFetch<GitLabProject>(this.client, `/projects/${encoded}`);
      // Cache project ID while we have it
      this.setCachedProjectId(`${owner}/${repo}`, project.id);
      return mapRepository(project);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  // --- Issues ---

  private async listIssues(
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

      const stateFilter = mapStateFilter(options?.state);
      if (stateFilter) {
        query.state = stateFilter;
      }

      const response = await rawFetch<GitLabIssue[]>(this.client, `/projects/${projectId}/issues`, {
        query,
      });

      const issues = (response.data ?? []).map(mapIssue);
      return this.parsePagination(issues, response.headers);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  private async getIssue(owner: string, repo: string, iid: number): Promise<Issue> {
    try {
      const projectId = await this.resolveProjectId(owner, repo);
      const issue = await cachedFetch<GitLabIssue>(
        this.client,
        `/projects/${projectId}/issues/${iid}`,
      );
      return mapIssue(issue);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  private async createIssue(owner: string, repo: string, input: CreateIssueInput): Promise<Issue> {
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
      return mapIssue(issue);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  // --- Merge Requests (mapped to Pull Requests) ---

  private async listMergeRequests(
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

      const stateFilter = mapStateFilter(options?.state);
      if (stateFilter) {
        query.state = stateFilter;
      }

      const response = await rawFetch<GitLabMergeRequest[]>(
        this.client,
        `/projects/${projectId}/merge_requests`,
        { query },
      );

      const prs = (response.data ?? []).map(mapMergeRequest);
      return this.parsePagination(prs, response.headers);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  private async getMergeRequest(owner: string, repo: string, iid: number): Promise<PullRequest> {
    try {
      const projectId = await this.resolveProjectId(owner, repo);
      const mr = await cachedFetch<GitLabMergeRequest>(
        this.client,
        `/projects/${projectId}/merge_requests/${iid}`,
      );
      return mapMergeRequest(mr);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  private async createMergeRequest(
    owner: string,
    repo: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequest> {
    try {
      const projectId = await this.resolveProjectId(owner, repo);
      const mr = await this.client<GitLabMergeRequest>(`/projects/${projectId}/merge_requests`, {
        method: "POST",
        body: {
          title: input.title,
          description: input.body,
          source_branch: input.sourceBranch,
          target_branch: input.targetBranch,
          // GitLab uses squash_on_merge or draft prefix, but direct draft field works on newer versions
        },
      });
      return mapMergeRequest(mr);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  // --- Users ---

  private async getUser(username: string): Promise<User> {
    try {
      // GitLab doesn't have a direct /users/:username endpoint.
      // Instead, search by username and take the first result.
      const users = await cachedFetch<GitLabUser[]>(this.client, "/users", { query: { username } });

      if (!users.length) {
        throw new NotFoundError(`User not found: ${username}`, "gitlab");
      }

      return mapUser(users[0]);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }

  private async getAuthenticatedUser(): Promise<User> {
    try {
      const user = await cachedFetch<GitLabUser>(this.client, "/user");
      return mapUser(user);
    } catch (error: unknown) {
      throw normalizeError(error, "gitlab");
    }
  }
}

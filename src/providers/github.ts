/**
 * GitHub provider implementation
 * Also serves GitBucket (GitHub API v3 compatible) via custom baseURL
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
import { createHttpClient, rawFetch, type HttpClient } from "../http.ts";
import { cachedFetch } from "../cache.ts";
import { parseLinkHeader } from "../pagination.ts";
import { encodePathSegment } from "./base-url.ts";
import { normalizeError } from "../errors.ts";

// --- GitHub API response types (snake_case) ---

interface GitHubOwner {
  login: string;
  avatar_url: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  html_url: string;
  clone_url: string;
  owner: GitHubOwner;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  site_admin: boolean;
}

interface GitHubLabel {
  name: string;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: GitHubLabel[];
  user: { login: string };
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}

interface GitHubPullRequest extends GitHubIssue {
  head: { ref: string };
  base: { ref: string };
  merged: boolean;
  draft: boolean;
}

interface GitHubRawTypes extends ProviderRawTypes {
  owner: GitHubOwner;
  repository: GitHubRepo;
  issue: GitHubIssue;
  pullRequest: GitHubPullRequest;
  user: GitHubUser;
}

// --- Pagination helper ---

function buildPageResult<TRaw, TMapped>(
  items: TRaw[],
  headers: Headers,
  mapper: (raw: TRaw) => TMapped,
): PageResult<TMapped> {
  const links = parseLinkHeader(headers.get("Link"));
  let nextPage: number | undefined;

  if (links.next) {
    const url = new URL(links.next);
    const page = url.searchParams.get("page");
    if (page) {
      nextPage = parseInt(page, 10);
    }
  }

  return {
    items: items.map(mapper),
    hasNextPage: !!links.next,
    nextPage,
  };
}

// --- Provider ---

export class GitHubProvider extends Provider<GitHubRawTypes> {
  private client: HttpClient;

  constructor(config: ProviderConfig) {
    super();
    this.client = createHttpClient({
      baseURL: config.baseURL || "https://api.github.com",
      token: config.token ?? "",
      tokenHeader: "Authorization",
      tokenPrefix: "token ",
    });
  }

  protected override mapOwner(raw: GitHubOwner): Owner {
    return {
      login: raw.login,
      avatarUrl: raw.avatar_url,
    };
  }

  protected override mapRepository(raw: GitHubRepo): Repository {
    return {
      id: String(raw.id),
      name: raw.name,
      fullName: raw.full_name,
      description: raw.description ?? "",
      private: raw.private,
      defaultBranch: raw.default_branch,
      url: raw.html_url,
      cloneUrl: raw.clone_url,
      owner: this.mapOwner(raw.owner),
    };
  }

  protected override mapIssue(raw: GitHubIssue): Issue {
    return {
      id: String(raw.id),
      number: raw.number,
      title: raw.title,
      body: raw.body ?? "",
      state: raw.state as IssueState,
      labels: raw.labels.map((label) => label.name),
      author: { login: raw.user.login },
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  }

  protected override mapPullRequest(raw: GitHubPullRequest): PullRequest {
    return {
      ...this.mapIssue(raw),
      sourceBranch: raw.head.ref,
      targetBranch: raw.base.ref,
      merged: raw.merged,
      draft: raw.draft,
    };
  }

  protected override mapUser(raw: GitHubUser): User {
    return {
      id: String(raw.id),
      login: raw.login,
      name: raw.name ?? "",
      email: raw.email ?? "",
      avatarUrl: raw.avatar_url,
      isAdmin: raw.site_admin,
    };
  }

  // --- Repos ---

  protected override async listRepos(
    owner: string,
    options?: ListOptions,
  ): Promise<PageResult<Repository>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);

      const { data, headers } = await rawFetch<GitHubRepo[]>(
        this.client,
        `/users/${encodePathSegment(owner)}/repos`,
        { query },
      );

      return buildPageResult(data ?? [], headers, (raw) => this.mapRepository(raw));
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async getRepo(owner: string, repo: string): Promise<Repository> {
    try {
      const data = await cachedFetch<GitHubRepo>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`,
      );
      return this.mapRepository(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  // --- Issues ---

  protected override async listIssues(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<Issue>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);
      if (options?.state) query.state = options.state;

      const { data, headers } = await rawFetch<GitHubIssue[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues`,
        { query },
      );

      const issuesOnly = (data ?? []).filter((issue) => issue.pull_request === undefined);
      return buildPageResult(issuesOnly, headers, (raw) => this.mapIssue(raw));
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async getIssue(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<Issue> {
    try {
      const data = await cachedFetch<GitHubIssue>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues/${encodePathSegment(issueNumber)}`,
      );
      return this.mapIssue(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async createIssue(
    owner: string,
    repo: string,
    input: CreateIssueInput,
  ): Promise<Issue> {
    try {
      const data = await this.client<GitHubIssue>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues`,
        {
          method: "POST",
          body: {
            title: input.title,
            body: input.body,
            labels: input.labels,
          },
        },
      );
      return this.mapIssue(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  // --- Pull Requests ---

  protected override async listPullRequests(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<PullRequest>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);
      if (options?.state) query.state = options.state;

      const { data, headers } = await rawFetch<GitHubPullRequest[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls`,
        { query },
      );

      return buildPageResult(data ?? [], headers, (raw) => this.mapPullRequest(raw));
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async getPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PullRequest> {
    try {
      const data = await cachedFetch<GitHubPullRequest>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(prNumber)}`,
      );
      return this.mapPullRequest(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async createPullRequest(
    owner: string,
    repo: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequest> {
    try {
      const data = await this.client<GitHubPullRequest>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls`,
        {
          method: "POST",
          body: {
            title: input.title,
            body: input.body,
            head: input.sourceBranch,
            base: input.targetBranch,
            draft: input.draft,
          },
        },
      );
      return this.mapPullRequest(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  // --- Users ---

  protected override async getUser(username: string): Promise<User> {
    try {
      const data = await cachedFetch<GitHubUser>(
        this.client,
        `/users/${encodePathSegment(username)}`,
      );
      return this.mapUser(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async getAuthenticatedUser(): Promise<User> {
    try {
      const data = await cachedFetch<GitHubUser>(this.client, "/user");
      return this.mapUser(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }
}

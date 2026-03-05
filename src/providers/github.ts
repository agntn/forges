/**
 * GitHub provider implementation
 * Also serves GitBucket (GitHub API v3 compatible) via custom baseURL
 */

import type {
  Provider,
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
  RepositoryResource,
  IssueResource,
  PullRequestResource,
  UserResource,
  IssueState,
} from '../types.js';
import { createHttpClient, rawFetch } from '../http.js';
import { cachedFetch } from '../cache.js';
import { parseLinkHeader } from '../pagination.js';
import { normalizeError } from '../errors.js';

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

// --- Mappers (snake_case → camelCase) ---

function mapOwner(gh: GitHubOwner): Owner {
  return {
    login: gh.login,
    avatarUrl: gh.avatar_url,
  };
}

function mapRepository(gh: GitHubRepo): Repository {
  return {
    id: String(gh.id),
    name: gh.name,
    fullName: gh.full_name,
    description: gh.description ?? '',
    private: gh.private,
    defaultBranch: gh.default_branch,
    url: gh.html_url,
    cloneUrl: gh.clone_url,
    owner: mapOwner(gh.owner),
  };
}

function mapUser(gh: GitHubUser): User {
  return {
    id: String(gh.id),
    login: gh.login,
    name: gh.name ?? '',
    email: gh.email ?? '',
    avatarUrl: gh.avatar_url,
    isAdmin: gh.site_admin,
  };
}

function mapIssue(gh: GitHubIssue): Issue {
  return {
    id: String(gh.id),
    number: gh.number,
    title: gh.title,
    body: gh.body ?? '',
    state: gh.state as IssueState,
    labels: gh.labels.map((l) => l.name),
    author: { login: gh.user.login },
    createdAt: gh.created_at,
    updatedAt: gh.updated_at,
  };
}

function mapPullRequest(gh: GitHubPullRequest): PullRequest {
  return {
    ...mapIssue(gh),
    sourceBranch: gh.head.ref,
    targetBranch: gh.base.ref,
    merged: gh.merged,
    draft: gh.draft,
  };
}

// --- Pagination helper ---

function buildPageResult<TRaw, TMapped>(
  items: TRaw[],
  headers: Headers,
  mapper: (raw: TRaw) => TMapped
): PageResult<TMapped> {
  const links = parseLinkHeader(headers.get('Link'));
  let nextPage: number | undefined;

  if (links.next) {
    const url = new URL(links.next);
    const page = url.searchParams.get('page');
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

export class GitHubProvider implements Provider {
  private client: ReturnType<typeof createHttpClient>;
  public repos: RepositoryResource;
  public issues: IssueResource;
  public pullRequests: PullRequestResource;
  public users: UserResource;

  constructor(config: ProviderConfig) {
    this.client = createHttpClient({
      baseURL: config.baseURL || 'https://api.github.com',
      token: config.token ?? '',
      tokenHeader: 'Authorization',
      tokenPrefix: 'token ',
    });

    this.repos = {
      list: (owner, options) => this.listRepos(owner, options),
      get: (owner, repo) => this.getRepo(owner, repo),
    };

    this.issues = {
      list: (owner, repo, options) => this.listIssues(owner, repo, options),
      get: (owner, repo, num) => this.getIssue(owner, repo, num),
      create: (owner, repo, input) => this.createIssue(owner, repo, input),
    };

    this.pullRequests = {
      list: (owner, repo, options) =>
        this.listPullRequests(owner, repo, options),
      get: (owner, repo, num) => this.getPullRequest(owner, repo, num),
      create: (owner, repo, input) =>
        this.createPullRequest(owner, repo, input),
    };

    this.users = {
      get: (username) => this.getUser(username),
      authenticated: () => this.getAuthenticatedUser(),
    };
  }

  // --- Repos ---

  private async listRepos(
    owner: string,
    options?: ListOptions
  ): Promise<PageResult<Repository>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);

      const { data, headers } = await rawFetch<GitHubRepo[]>(
        this.client,
        `/users/${owner}/repos`,
        { query }
      );

      return buildPageResult(data ?? [], headers, mapRepository);
    } catch (error) {
      throw normalizeError(error, 'github');
    }
  }

  private async getRepo(owner: string, repo: string): Promise<Repository> {
    try {
      const data = await cachedFetch<GitHubRepo>(
        this.client,
        `/repos/${owner}/${repo}`
      );
      return mapRepository(data);
    } catch (error) {
      throw normalizeError(error, 'github');
    }
  }

  // --- Issues ---

  private async listIssues(
    owner: string,
    repo: string,
    options?: ListOptions
  ): Promise<PageResult<Issue>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);
      if (options?.state) query.state = options.state;

      const { data, headers } = await rawFetch<GitHubIssue[]>(
        this.client,
        `/repos/${owner}/${repo}/issues`,
        { query }
      );

      const issuesOnly = (data ?? []).filter((issue) => issue.pull_request === undefined);
      return buildPageResult(issuesOnly, headers, mapIssue);
    } catch (error) {
      throw normalizeError(error, 'github');
    }
  }

  private async getIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<Issue> {
    try {
      const data = await cachedFetch<GitHubIssue>(
        this.client,
        `/repos/${owner}/${repo}/issues/${issueNumber}`
      );
      return mapIssue(data);
    } catch (error) {
      throw normalizeError(error, 'github');
    }
  }

  private async createIssue(
    owner: string,
    repo: string,
    input: CreateIssueInput
  ): Promise<Issue> {
    try {
      const data = await this.client<GitHubIssue>(
        `/repos/${owner}/${repo}/issues`,
        {
          method: 'POST',
          body: {
            title: input.title,
            body: input.body,
            labels: input.labels,
          },
        }
      );
      return mapIssue(data);
    } catch (error) {
      throw normalizeError(error, 'github');
    }
  }

  // --- Pull Requests ---

  private async listPullRequests(
    owner: string,
    repo: string,
    options?: ListOptions
  ): Promise<PageResult<PullRequest>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);
      if (options?.state) query.state = options.state;

      const { data, headers } = await rawFetch<GitHubPullRequest[]>(
        this.client,
        `/repos/${owner}/${repo}/pulls`,
        { query }
      );

      return buildPageResult(data ?? [], headers, mapPullRequest);
    } catch (error) {
      throw normalizeError(error, 'github');
    }
  }

  private async getPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<PullRequest> {
    try {
      const data = await cachedFetch<GitHubPullRequest>(
        this.client,
        `/repos/${owner}/${repo}/pulls/${prNumber}`
      );
      return mapPullRequest(data);
    } catch (error) {
      throw normalizeError(error, 'github');
    }
  }

  private async createPullRequest(
    owner: string,
    repo: string,
    input: CreatePullRequestInput
  ): Promise<PullRequest> {
    try {
      const data = await this.client<GitHubPullRequest>(
        `/repos/${owner}/${repo}/pulls`,
        {
          method: 'POST',
          body: {
            title: input.title,
            body: input.body,
            head: input.sourceBranch,
            base: input.targetBranch,
            draft: input.draft,
          },
        }
      );
      return mapPullRequest(data);
    } catch (error) {
      throw normalizeError(error, 'github');
    }
  }

  // --- Users ---

  private async getUser(username: string): Promise<User> {
    try {
      const data = await cachedFetch<GitHubUser>(
        this.client,
        `/users/${username}`
      );
      return mapUser(data);
    } catch (error) {
      throw normalizeError(error, 'github');
    }
  }

  private async getAuthenticatedUser(): Promise<User> {
    try {
      const data = await cachedFetch<GitHubUser>(this.client, '/user');
      return mapUser(data);
    } catch (error) {
      throw normalizeError(error, 'github');
    }
  }
}

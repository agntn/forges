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
import { normalizeError } from "../errors.ts";
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
  CreateIssueInput,
  CreatePullRequestInput,
} from "../types.ts";

// -- Raw Gitea API response types --

interface GiteaUser {
  id: number;
  login: string;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  is_admin?: boolean;
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

interface GiteaRawTypes extends ProviderRawTypes {
  owner: GiteaOwner;
  repository: GiteaRepository;
  issue: GiteaIssue;
  pullRequest: GiteaPullRequest;
  user: GiteaUser;
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

  protected override mapUser(raw: GiteaUser): User {
    return {
      id: String(raw.id),
      login: raw.login,
      name: raw.full_name ?? "",
      email: raw.email ?? "",
      avatarUrl: raw.avatar_url ?? "",
      isAdmin: raw.is_admin ?? false,
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
}

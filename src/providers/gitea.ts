/**
 * Gitea/Forgejo provider implementation
 * API v1 - similar to GitHub but with key differences:
 * - Base path: /api/v1
 * - Pagination uses `limit` param instead of `per_page`
 * - Some fields may be null where GitHub returns empty strings
 */

import { createHttpClient, rawFetch } from '../http';
import { cachedFetch } from '../cache';
import { parseLinkHeader } from '../pagination';
import { normalizeError } from '../errors';
import { normalizeApiBaseURL } from './base-url';
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
} from '../types';

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

// -- Field mappers --

function mapUser(raw: GiteaUser): User {
  return {
    id: String(raw.id),
    login: raw.login,
    name: raw.full_name ?? '',
    email: raw.email ?? '',
    avatarUrl: raw.avatar_url ?? '',
    isAdmin: raw.is_admin ?? false,
  };
}

function mapOwner(raw: GiteaOwner): Owner {
  return {
    login: raw.login,
    avatarUrl: raw.avatar_url ?? '',
  };
}

function mapRepository(raw: GiteaRepository): Repository {
  return {
    id: String(raw.id),
    name: raw.name,
    fullName: raw.full_name,
    description: raw.description ?? '',
    private: raw.private,
    defaultBranch: raw.default_branch ?? 'main',
    url: raw.html_url ?? '',
    cloneUrl: raw.clone_url ?? '',
    owner: mapOwner(raw.owner),
  };
}

function mapIssue(raw: GiteaIssue): Issue {
  return {
    id: String(raw.id),
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    state: raw.state === 'open' ? 'open' : 'closed',
    labels: raw.labels?.map((l) => l.name) ?? [],
    author: { login: raw.user.login },
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapPullRequest(raw: GiteaPullRequest): PullRequest {
  return {
    id: String(raw.id),
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    state: raw.state === 'open' ? 'open' : 'closed',
    labels: raw.labels?.map((l) => l.name) ?? [],
    author: { login: raw.user.login },
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    sourceBranch: raw.head?.ref ?? '',
    targetBranch: raw.base?.ref ?? '',
    merged: raw.merged ?? false,
    draft: raw.draft ?? false,
  };
}

// -- Pagination helper --

function buildPageResult<TRaw, T>(
  data: TRaw[],
  headers: Headers,
  mapper: (raw: TRaw) => T
): PageResult<T> {
  const items = data.map(mapper);
  const links = parseLinkHeader(headers.get('Link'));
  const hasNextPage = !!links.next;

  let nextPage: number | undefined;
  if (links.next) {
    try {
      const url = new URL(links.next);
      const page = url.searchParams.get('page');
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

// -- Provider factory --

const PLATFORM = 'gitea';

/**
 * Create a Gitea/Forgejo provider instance.
 *
 * @param config Provider configuration. `baseURL` defaults to `https://gitea.com/api/v1`.
 */
export function createGiteaProvider(config: ProviderConfig): Provider {
  const baseURL = normalizeApiBaseURL(
    config.baseURL,
    'https://gitea.com/api/v1',
    '/api/v1'
  );

  const client = createHttpClient({
    baseURL,
    token: config.token ?? '',
    tokenHeader: 'Authorization',
    tokenPrefix: 'token ',
  });

  // -- repos --

  const repos: RepositoryResource = {
    async list(owner, options?) {
      try {
        const query = buildListQuery(options);
        const { data, headers } = await rawFetch<GiteaRepository[]>(
          client,
          `/users/${owner}/repos`,
          { query }
        );
        return buildPageResult(data ?? [], headers, mapRepository);
      } catch (error) {
        throw normalizeError(error, PLATFORM);
      }
    },

    async get(owner, repo) {
      try {
        return mapRepository(
          await cachedFetch<GiteaRepository>(client, `/repos/${owner}/${repo}`)
        );
      } catch (error) {
        throw normalizeError(error, PLATFORM);
      }
    },
  };

  // -- issues --

  const issues: IssueResource = {
    async list(owner, repo, options?) {
      try {
        const query = buildListQuery(options);
        query.type = 'issues'; // exclude PRs from issue list
        const { data, headers } = await rawFetch<GiteaIssue[]>(
          client,
          `/repos/${owner}/${repo}/issues`,
          { query }
        );
        return buildPageResult(data ?? [], headers, mapIssue);
      } catch (error) {
        throw normalizeError(error, PLATFORM);
      }
    },

    async get(owner, repo, number) {
      try {
        return mapIssue(
          await cachedFetch<GiteaIssue>(client, `/repos/${owner}/${repo}/issues/${number}`)
        );
      } catch (error) {
        throw normalizeError(error, PLATFORM);
      }
    },

    async create(owner, repo, input) {
      try {
        const body: Record<string, unknown> = {
          title: input.title,
          body: input.body,
        };
        if (input.labels?.length) {
          body.labels = input.labels;
        }
        return mapIssue(
          await client<GiteaIssue>(`/repos/${owner}/${repo}/issues`, {
            method: 'POST',
            body,
          })
        );
      } catch (error) {
        throw normalizeError(error, PLATFORM);
      }
    },
  };

  // -- pullRequests --

  const pullRequests: PullRequestResource = {
    async list(owner, repo, options?) {
      try {
        const query = buildListQuery(options);
        const { data, headers } = await rawFetch<GiteaPullRequest[]>(
          client,
          `/repos/${owner}/${repo}/pulls`,
          { query }
        );
        return buildPageResult(data ?? [], headers, mapPullRequest);
      } catch (error) {
        throw normalizeError(error, PLATFORM);
      }
    },

    async get(owner, repo, number) {
      try {
        return mapPullRequest(
          await cachedFetch<GiteaPullRequest>(client, `/repos/${owner}/${repo}/pulls/${number}`)
        );
      } catch (error) {
        throw normalizeError(error, PLATFORM);
      }
    },

    async create(owner, repo, input) {
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
        return mapPullRequest(
          await client<GiteaPullRequest>(`/repos/${owner}/${repo}/pulls`, {
            method: 'POST',
            body,
          })
        );
      } catch (error) {
        throw normalizeError(error, PLATFORM);
      }
    },
  };

  // -- users --

  const users: UserResource = {
    async get(username) {
      try {
        return mapUser(
          await cachedFetch<GiteaUser>(client, `/users/${username}`)
        );
      } catch (error) {
        throw normalizeError(error, PLATFORM);
      }
    },

    async authenticated() {
      try {
        return mapUser(
          await cachedFetch<GiteaUser>(client, '/user')
        );
      } catch (error) {
        throw normalizeError(error, PLATFORM);
      }
    },
  };

  return { repos, issues, pullRequests, users };
}

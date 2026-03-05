import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FetchError } from 'ofetch';
import {
  NotFoundError,
  AuthenticationError,
  RateLimitError,
  GixaError,
} from '../src/errors.js';

// --- Hoisted mocks ---

const mocks = vi.hoisted(() => {
  const client = vi.fn();
  return {
    client,
    createHttpClient: vi.fn(() => client),
    rawFetch: vi.fn(),
    cachedFetch: vi.fn(),
  };
});

vi.mock('../src/http.js', () => ({
  createHttpClient: mocks.createHttpClient,
  rawFetch: mocks.rawFetch,
  FetchError,
}));

vi.mock('../src/cache.js', () => ({
  cachedFetch: mocks.cachedFetch,
}));

import { GitHubProvider } from '../src/providers/github.js';

// --- Fixtures (snake_case matching real GitHub API) ---

const ghRepo = {
  id: 12345,
  name: 'hello-world',
  full_name: 'octocat/hello-world',
  description: 'My first repository on GitHub!',
  private: false,
  default_branch: 'main',
  html_url: 'https://github.com/octocat/hello-world',
  clone_url: 'https://github.com/octocat/hello-world.git',
  owner: {
    login: 'octocat',
    avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
  },
};

const ghUser = {
  id: 583231,
  login: 'octocat',
  name: 'The Octocat',
  email: 'octocat@github.com',
  avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
  site_admin: false,
};

const ghIssue = {
  id: 1001,
  number: 42,
  title: 'Found a bug',
  body: 'Something is broken',
  state: 'open',
  labels: [{ name: 'bug' }, { name: 'priority:high' }],
  user: { login: 'reporter' },
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-16T12:00:00Z',
};

const ghPullRequest = {
  id: 2001,
  number: 99,
  title: 'Add dark mode',
  body: 'Implements dark mode toggle',
  state: 'open',
  labels: [{ name: 'enhancement' }],
  user: { login: 'contributor' },
  created_at: '2024-02-01T08:00:00Z',
  updated_at: '2024-02-02T09:00:00Z',
  head: { ref: 'feature/dark-mode' },
  base: { ref: 'main' },
  merged: false,
  draft: true,
};

// --- Helpers ---

function makeHeaders(link?: string): Headers {
  const h = new Headers();
  if (link) h.set('Link', link);
  return h;
}

function makeFetchError(status: number, message?: string): FetchError {
  const err = new FetchError(message || `HTTP ${status}`);
  err.status = status;
  err.statusCode = status;
  (err as any).response = { headers: new Headers(), status };
  return err;
}

const LINK_NEXT_PAGE_2 =
  '<https://api.github.com/user/repos?page=2>; rel="next", ' +
  '<https://api.github.com/user/repos?page=5>; rel="last"';

// --- Tests ---

describe('GitHubProvider', () => {
  let gh: GitHubProvider;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createHttpClient.mockReturnValue(mocks.client);
    gh = new GitHubProvider({
      baseURL: 'https://api.github.com',
      token: 'ghp_test',
    });
  });

  describe('constructor', () => {
    it('creates http client with GitHub auth config', () => {
      expect(mocks.createHttpClient).toHaveBeenCalledWith({
        baseURL: 'https://api.github.com',
        token: 'ghp_test',
        tokenHeader: 'Authorization',
        tokenPrefix: 'token ',
      });
    });

    it('defaults baseURL when empty', () => {
      new GitHubProvider({ baseURL: '', token: 't' });
      expect(mocks.createHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: 'https://api.github.com' }),
      );
    });
  });

  // --- Repos ---

  describe('repos.list', () => {
    it('returns mapped repositories', async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [ghRepo],
        headers: makeHeaders(),
      });

      const result = await gh.repos.list('octocat');

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: '12345',
        name: 'hello-world',
        fullName: 'octocat/hello-world',
        private: false,
        defaultBranch: 'main',
        url: 'https://github.com/octocat/hello-world',
        cloneUrl: 'https://github.com/octocat/hello-world.git',
        owner: {
          login: 'octocat',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        },
      });
    });

    it('forwards pagination options as query params', async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [],
        headers: makeHeaders(),
      });

      await gh.repos.list('octocat', { page: 3, perPage: 50 });

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        '/users/octocat/repos',
        { query: { page: '3', per_page: '50' } },
      );
    });

    it('handles null data gracefully', async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: null,
        headers: makeHeaders(),
      });

      const result = await gh.repos.list('octocat');
      expect(result.items).toEqual([]);
    });
  });

  describe('repos.get', () => {
    it('returns mapped repository via cached fetch', async () => {
      mocks.cachedFetch.mockResolvedValueOnce(ghRepo);

      const repo = await gh.repos.get('octocat', 'hello-world');

      expect(mocks.cachedFetch).toHaveBeenCalledWith(
        mocks.client,
        '/repos/octocat/hello-world',
      );
      expect(repo.fullName).toBe('octocat/hello-world');
    });
  });

  // --- Issues ---

  describe('issues.list', () => {
    it('returns mapped issues', async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [ghIssue],
        headers: makeHeaders(),
      });

      const result = await gh.issues.list('octocat', 'hello-world');

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: '1001',
        number: 42,
        title: 'Found a bug',
        body: 'Something is broken',
        state: 'open',
        labels: ['bug', 'priority:high'],
        author: { login: 'reporter' },
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-16T12:00:00Z',
      });
    });

    it('passes state filter', async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [],
        headers: makeHeaders(),
      });

      await gh.issues.list('octocat', 'hello-world', { state: 'closed' });

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        '/repos/octocat/hello-world/issues',
        { query: expect.objectContaining({ state: 'closed' }) },
      );
    });

    it('filters out pull requests from issues endpoint response', async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [
          ghIssue,
          {
            ...ghIssue,
            id: 9999,
            number: 123,
            pull_request: { url: 'https://api.github.com/repos/o/r/pulls/123' },
          },
        ],
        headers: makeHeaders(),
      });

      const result = await gh.issues.list('octocat', 'hello-world');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].number).toBe(42);
    });
  });

  describe('issues.get', () => {
    it('returns single mapped issue', async () => {
      mocks.cachedFetch.mockResolvedValueOnce(ghIssue);

      const issue = await gh.issues.get('octocat', 'hello-world', 42);

      expect(mocks.cachedFetch).toHaveBeenCalledWith(
        mocks.client,
        '/repos/octocat/hello-world/issues/42',
      );
      expect(issue.number).toBe(42);
      expect(issue.author.login).toBe('reporter');
    });
  });

  describe('issues.create', () => {
    it('sends POST with correct body', async () => {
      const created = { ...ghIssue, id: 1002, number: 43 };
      mocks.client.mockResolvedValueOnce(created);

      const issue = await gh.issues.create('octocat', 'hello-world', {
        title: 'New bug',
        body: 'Details here',
        labels: ['bug'],
      });

      expect(mocks.client).toHaveBeenCalledWith(
        '/repos/octocat/hello-world/issues',
        {
          method: 'POST',
          body: { title: 'New bug', body: 'Details here', labels: ['bug'] },
        },
      );
      expect(issue.number).toBe(43);
    });
  });

  // --- Pull Requests ---

  describe('pullRequests.list', () => {
    it('returns mapped pull requests', async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [ghPullRequest],
        headers: makeHeaders(),
      });

      const result = await gh.pullRequests.list('octocat', 'hello-world');

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: '2001',
        number: 99,
        title: 'Add dark mode',
        sourceBranch: 'feature/dark-mode',
        targetBranch: 'main',
        merged: false,
        draft: true,
      });
    });
  });

  describe('pullRequests.get', () => {
    it('returns single mapped pull request', async () => {
      mocks.cachedFetch.mockResolvedValueOnce(ghPullRequest);

      const pr = await gh.pullRequests.get('octocat', 'hello-world', 99);

      expect(pr.sourceBranch).toBe('feature/dark-mode');
      expect(pr.targetBranch).toBe('main');
      expect(pr.draft).toBe(true);
    });
  });

  describe('pullRequests.create', () => {
    it('maps sourceBranch/targetBranch to head/base', async () => {
      mocks.client.mockResolvedValueOnce(ghPullRequest);

      await gh.pullRequests.create('octocat', 'hello-world', {
        title: 'Add dark mode',
        body: 'Implements it',
        sourceBranch: 'feature/dark-mode',
        targetBranch: 'main',
        draft: true,
      });

      expect(mocks.client).toHaveBeenCalledWith(
        '/repos/octocat/hello-world/pulls',
        {
          method: 'POST',
          body: {
            title: 'Add dark mode',
            body: 'Implements it',
            head: 'feature/dark-mode',
            base: 'main',
            draft: true,
          },
        },
      );
    });
  });

  // --- Users ---

  describe('users.get', () => {
    it('returns mapped user', async () => {
      mocks.cachedFetch.mockResolvedValueOnce(ghUser);

      const user = await gh.users.get('octocat');

      expect(mocks.cachedFetch).toHaveBeenCalledWith(
        mocks.client,
        '/users/octocat',
      );
      expect(user).toMatchObject({
        id: '583231',
        login: 'octocat',
        name: 'The Octocat',
        email: 'octocat@github.com',
        avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4',
        isAdmin: false,
      });
    });
  });

  describe('users.authenticated', () => {
    it('fetches /user endpoint', async () => {
      mocks.cachedFetch.mockResolvedValueOnce({ ...ghUser, site_admin: true });

      const user = await gh.users.authenticated();

      expect(mocks.cachedFetch).toHaveBeenCalledWith(mocks.client, '/user');
      expect(user.isAdmin).toBe(true);
    });
  });

  // --- Field Mapping Verification ---

  describe('field mapping (snake_case → camelCase)', () => {
    it('maps full_name → fullName', async () => {
      mocks.cachedFetch.mockResolvedValueOnce({
        ...ghRepo,
        full_name: 'org/my-repo',
      });
      const repo = await gh.repos.get('org', 'my-repo');
      expect(repo.fullName).toBe('org/my-repo');
    });

    it('maps avatar_url → avatarUrl', async () => {
      mocks.cachedFetch.mockResolvedValueOnce(ghRepo);
      const repo = await gh.repos.get('o', 'r');
      expect(repo.owner.avatarUrl).toBe(
        'https://avatars.githubusercontent.com/u/1?v=4',
      );
    });

    it('maps default_branch → defaultBranch', async () => {
      mocks.cachedFetch.mockResolvedValueOnce({
        ...ghRepo,
        default_branch: 'develop',
      });
      const repo = await gh.repos.get('o', 'r');
      expect(repo.defaultBranch).toBe('develop');
    });

    it('maps html_url → url', async () => {
      mocks.cachedFetch.mockResolvedValueOnce(ghRepo);
      const repo = await gh.repos.get('o', 'r');
      expect(repo.url).toBe('https://github.com/octocat/hello-world');
    });

    it('maps clone_url → cloneUrl', async () => {
      mocks.cachedFetch.mockResolvedValueOnce(ghRepo);
      const repo = await gh.repos.get('o', 'r');
      expect(repo.cloneUrl).toBe(
        'https://github.com/octocat/hello-world.git',
      );
    });

    it('maps site_admin → isAdmin', async () => {
      mocks.cachedFetch.mockResolvedValueOnce({
        ...ghUser,
        site_admin: true,
      });
      const user = await gh.users.get('admin');
      expect(user.isAdmin).toBe(true);
    });

    it('maps created_at → createdAt and updated_at → updatedAt', async () => {
      mocks.cachedFetch.mockResolvedValueOnce(ghIssue);
      const issue = await gh.issues.get('o', 'r', 42);
      expect(issue.createdAt).toBe('2024-01-15T10:00:00Z');
      expect(issue.updatedAt).toBe('2024-01-16T12:00:00Z');
    });

    it('maps user.login → author.login', async () => {
      mocks.cachedFetch.mockResolvedValueOnce({
        ...ghIssue,
        user: { login: 'specific-user' },
      });
      const issue = await gh.issues.get('o', 'r', 1);
      expect(issue.author.login).toBe('specific-user');
    });

    it('maps head.ref → sourceBranch and base.ref → targetBranch', async () => {
      mocks.cachedFetch.mockResolvedValueOnce({
        ...ghPullRequest,
        head: { ref: 'fix/typo' },
        base: { ref: 'develop' },
      });
      const pr = await gh.pullRequests.get('o', 'r', 1);
      expect(pr.sourceBranch).toBe('fix/typo');
      expect(pr.targetBranch).toBe('develop');
    });

    it('converts numeric id to string', async () => {
      mocks.cachedFetch.mockResolvedValueOnce({ ...ghRepo, id: 99999 });
      const repo = await gh.repos.get('o', 'r');
      expect(repo.id).toBe('99999');
    });

    it('defaults null description to empty string', async () => {
      mocks.cachedFetch.mockResolvedValueOnce({
        ...ghRepo,
        description: null,
      });
      const repo = await gh.repos.get('o', 'r');
      expect(repo.description).toBe('');
    });

    it('defaults null body to empty string', async () => {
      mocks.cachedFetch.mockResolvedValueOnce({ ...ghIssue, body: null });
      const issue = await gh.issues.get('o', 'r', 1);
      expect(issue.body).toBe('');
    });

    it('extracts label names from label objects', async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [ghIssue],
        headers: makeHeaders(),
      });
      const result = await gh.issues.list('o', 'r');
      expect(result.items[0].labels).toEqual(['bug', 'priority:high']);
    });
  });

  // --- Pagination ---

  describe('pagination', () => {
    it('parses Link header for next page', async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [ghRepo],
        headers: makeHeaders(LINK_NEXT_PAGE_2),
      });

      const result = await gh.repos.list('octocat');

      expect(result.hasNextPage).toBe(true);
      expect(result.nextPage).toBe(2);
    });

    it('returns hasNextPage=false when no Link header', async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [ghRepo],
        headers: makeHeaders(),
      });

      const result = await gh.repos.list('octocat');

      expect(result.hasNextPage).toBe(false);
      expect(result.nextPage).toBeUndefined();
    });

    it('parses higher page numbers from Link header', async () => {
      const link =
        '<https://api.github.com/repos?page=17>; rel="next", ' +
        '<https://api.github.com/repos?page=42>; rel="last"';
      mocks.rawFetch.mockResolvedValueOnce({
        data: [],
        headers: makeHeaders(link),
      });

      const result = await gh.repos.list('octocat');

      expect(result.nextPage).toBe(17);
    });
  });

  // --- Error Handling ---

  describe('error handling', () => {
    it('throws NotFoundError on 404', async () => {
      mocks.cachedFetch.mockRejectedValueOnce(makeFetchError(404));
      await expect(gh.repos.get('x', 'nonexistent')).rejects.toThrow(
        NotFoundError,
      );
    });

    it('throws AuthenticationError on 401', async () => {
      mocks.cachedFetch.mockRejectedValueOnce(makeFetchError(401));
      await expect(gh.users.authenticated()).rejects.toThrow(
        AuthenticationError,
      );
    });

    it('throws RateLimitError on 429', async () => {
      mocks.rawFetch.mockRejectedValueOnce(makeFetchError(429));
      await expect(gh.repos.list('x')).rejects.toThrow(RateLimitError);
    });

    it('sets platform to github on errors', async () => {
      mocks.cachedFetch.mockRejectedValueOnce(makeFetchError(500));

      const error = await gh.repos.get('x', 'y').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GixaError);
      expect((error as GixaError).platform).toBe('github');
    });

    it('preserves status code on generic errors', async () => {
      mocks.cachedFetch.mockRejectedValueOnce(makeFetchError(503));

      const error = await gh.repos.get('x', 'y').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GixaError);
      expect((error as GixaError).status).toBe(503);
    });
  });
});

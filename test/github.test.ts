import { describe, it, expect, beforeEach, vi } from "vitest";
import { FetchError } from "ofetch";
import { NotFoundError, AuthenticationError, RateLimitError, ForgesError } from "../src/errors.ts";

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

vi.mock("../src/http.ts", () => ({
  createHttpClient: mocks.createHttpClient,
  rawFetch: mocks.rawFetch,
  FetchError,
}));

vi.mock("../src/cache.ts", () => ({
  cachedFetch: mocks.cachedFetch,
}));

import { GitHubProvider } from "../src/providers/github.ts";

// --- Fixtures (snake_case matching real GitHub API) ---

const ghRepo = {
  id: 12345,
  name: "hello-world",
  full_name: "octocat/hello-world",
  description: "My first repository on GitHub!",
  private: false,
  default_branch: "main",
  html_url: "https://github.com/octocat/hello-world",
  clone_url: "https://github.com/octocat/hello-world.git",
  fork: false,
  parent: null,
  permissions: {
    admin: false,
    maintain: false,
    push: false,
    triage: false,
    pull: true,
  },
  owner: {
    login: "octocat",
    avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
  },
};

const ghCiRun = {
  id: 9876,
  head_branch: "main",
  head_sha: "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38",
  status: "completed",
  conclusion: "success",
  html_url: "https://github.com/octocat/hello-world/actions/runs/9876",
};

const ghUser = {
  id: 583231,
  login: "octocat",
  name: "The Octocat",
  email: "octocat@github.com",
  avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
  site_admin: false,
  bio: "How people build software.",
  company: "@github",
  location: "San Francisco",
  blog: "https://github.blog",
  followers: 23753,
  following: 9,
  created_at: "2011-01-25T18:44:36Z",
  html_url: "https://github.com/octocat",
};

const ghIssue = {
  id: 1001,
  number: 42,
  title: "Found a bug",
  body: "Something is broken",
  state: "open",
  labels: [{ name: "bug" }, { name: "priority:high" }],
  user: { login: "reporter" },
  assignees: [{ login: "triager" }],
  created_at: "2024-01-15T10:00:00Z",
  updated_at: "2024-01-16T12:00:00Z",
  html_url: "https://github.com/octocat/hello-world/issues/42",
};

const ghPullRequest = {
  id: 2001,
  number: 99,
  title: "Add dark mode",
  body: "Implements dark mode toggle",
  state: "open",
  labels: [{ name: "enhancement" }],
  user: { login: "contributor" },
  assignees: [{ login: "maintainer" }],
  created_at: "2024-02-01T08:00:00Z",
  updated_at: "2024-02-02T09:00:00Z",
  html_url: "https://github.com/octocat/hello-world/pull/99",
  head: { ref: "feature/dark-mode", sha: "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38" },
  base: { ref: "main" },
  merged: false,
  merged_at: null,
  draft: true,
  merge_commit_sha: "1e2367db3db90761dcd1dfa353898d8368f2262d",
  mergeable: true,
  mergeable_state: "blocked",
};

const ghComment = {
  id: 3001,
  body: "Reproduced on 1.2.3 as well",
  user: { login: "commenter" },
  html_url: "https://github.com/octocat/hello-world/issues/42#issuecomment-3001",
  issue_url: "https://api.github.com/repos/octocat/hello-world/issues/42",
  created_at: "2024-01-17T09:00:00Z",
  updated_at: "2024-01-17T09:30:00Z",
};

const ghThreadScope = {
  number: 99,
  repository: { name: "hello-world", owner: { login: "octocat" } },
};

const ghThreadNode = {
  id: "PRRT_kwDOA",
  isResolved: false,
  isOutdated: false,
  path: "src/index.ts",
  line: 12,
  startLine: 10,
  pullRequest: ghThreadScope,
  comments: {
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [
      {
        databaseId: 9001,
        fullDatabaseId: "9001",
        body: "Please fix this",
        url: "https://github.com/octocat/hello-world/pull/99#discussion_r9001",
        createdAt: "2024-02-03T10:00:00Z",
        author: { login: "reviewer" },
      },
    ],
  },
};

function graphqlThreadList(nodes: unknown[], hasNextPage = false, endCursor: string | null = null) {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage, endCursor },
            nodes,
          },
        },
      },
    },
  };
}

// --- Helpers ---

function makeHeaders(link?: string): Headers {
  const h = new Headers();
  if (link) h.set("Link", link);
  return h;
}

function makeFetchError(status: number, message?: string): FetchError {
  const err = new FetchError(message || `HTTP ${status}`);
  err.status = status;
  err.statusCode = status;
  err.response = Object.assign(new Response(null, { status }), { _data: undefined });
  return err;
}

const LINK_NEXT_PAGE_2 =
  '<https://api.github.com/user/repos?page=2>; rel="next", ' +
  '<https://api.github.com/user/repos?page=5>; rel="last"';

// --- Tests ---

describe("GitHubProvider", () => {
  let gh: GitHubProvider;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createHttpClient.mockReturnValue(mocks.client);
    gh = new GitHubProvider({
      baseURL: "https://api.github.com",
      token: "ghp_test",
    });
  });

  describe("constructor", () => {
    it("creates http client with GitHub auth config", () => {
      expect(mocks.createHttpClient).toHaveBeenCalledWith({
        baseURL: "https://api.github.com",
        token: "ghp_test",
        tokenHeader: "Authorization",
        tokenPrefix: "token ",
      });
    });

    it("defaults baseURL when empty", () => {
      new GitHubProvider({ baseURL: "", token: "t" });
      expect(mocks.createHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: "https://api.github.com" }),
      );
    });
  });

  // --- Repos ---

  describe("repos.list", () => {
    it("returns mapped repositories from the organization route", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [ghRepo],
        headers: makeHeaders(),
      });

      const result = await gh.repos.list("octocat");

      expect(mocks.rawFetch).toHaveBeenCalledTimes(1);
      expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/orgs/octocat/repos", {
        query: {},
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: "12345",
        name: "hello-world",
        fullName: "octocat/hello-world",
        private: false,
        defaultBranch: "main",
        url: "https://github.com/octocat/hello-world",
        cloneUrl: "https://github.com/octocat/hello-world.git",
        owner: {
          login: "octocat",
          avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        },
      });
    });

    it("falls back to the user route when the owner is not an organization", async () => {
      mocks.rawFetch
        .mockRejectedValueOnce(makeFetchError(404))
        .mockResolvedValueOnce({ data: [ghRepo], headers: makeHeaders() });

      const result = await gh.repos.list("octocat");

      expect(mocks.rawFetch).toHaveBeenCalledTimes(2);
      expect(mocks.rawFetch).toHaveBeenNthCalledWith(1, mocks.client, "/orgs/octocat/repos", {
        query: {},
      });
      expect(mocks.rawFetch).toHaveBeenNthCalledWith(2, mocks.client, "/users/octocat/repos", {
        query: {},
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ id: "12345", name: "hello-world" });
    });

    it("reports not found when both routes 404", async () => {
      mocks.rawFetch
        .mockRejectedValueOnce(makeFetchError(404))
        .mockRejectedValueOnce(makeFetchError(404));

      await expect(gh.repos.list("ghost")).rejects.toThrow(NotFoundError);
      expect(mocks.rawFetch).toHaveBeenCalledTimes(2);
    });

    it("re-throws non-404 organization route errors without falling back", async () => {
      mocks.rawFetch.mockRejectedValueOnce(makeFetchError(500));

      await expect(gh.repos.list("octocat")).rejects.toThrow(ForgesError);
      expect(mocks.rawFetch).toHaveBeenCalledTimes(1);
    });

    it("forwards pagination options to both routes", async () => {
      mocks.rawFetch
        .mockRejectedValueOnce(makeFetchError(404))
        .mockResolvedValueOnce({ data: [], headers: makeHeaders() });

      await gh.repos.list("octocat", { page: 3, perPage: 50 });

      expect(mocks.rawFetch).toHaveBeenNthCalledWith(1, mocks.client, "/orgs/octocat/repos", {
        query: { page: "3", per_page: "50" },
      });
      expect(mocks.rawFetch).toHaveBeenNthCalledWith(2, mocks.client, "/users/octocat/repos", {
        query: { page: "3", per_page: "50" },
      });
    });

    it("handles null data gracefully", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: null,
        headers: makeHeaders(),
      });

      const result = await gh.repos.list("octocat");
      expect(result.items).toEqual([]);
    });
  });

  describe("repos.get", () => {
    it("returns a mapped repository", async () => {
      mocks.client.mockResolvedValueOnce(ghRepo);

      const repo = await gh.repos.get("octocat", "hello-world");

      expect(mocks.client).toHaveBeenCalledWith("/repos/octocat/hello-world");
      expect(repo.fullName).toBe("octocat/hello-world");
      expect(repo.isFork).toBe(false);
      expect(repo.parent).toBeNull();
      expect(repo.viewerPermission).toBe("read");
    });

    it("maps a fork parent and the highest viewer permission", async () => {
      mocks.client.mockResolvedValueOnce({
        ...ghRepo,
        fork: true,
        parent: {
          full_name: "upstream/hello-world",
          html_url: "https://github.com/upstream/hello-world",
        },
        permissions: {
          admin: false,
          maintain: true,
          push: true,
          triage: true,
          pull: true,
        },
      });

      const repo = await gh.repos.get("octocat", "hello-world");

      expect(repo).toMatchObject({
        isFork: true,
        parent: {
          fullName: "upstream/hello-world",
          url: "https://github.com/upstream/hello-world",
        },
        viewerPermission: "maintain",
      });
    });

    it("keeps omitted viewer permissions unknown", async () => {
      mocks.client.mockResolvedValueOnce({ ...ghRepo, permissions: undefined });

      const repo = await gh.repos.get("octocat", "hello-world");

      expect(repo.viewerPermission).toBeNull();
    });

    it("reads current viewer permission on every call", async () => {
      mocks.cachedFetch.mockResolvedValue(ghRepo);
      mocks.client.mockResolvedValueOnce(ghRepo).mockResolvedValueOnce({
        ...ghRepo,
        permissions: { ...ghRepo.permissions, admin: true },
      });

      await gh.repos.get("octocat", "hello-world");
      const repository = await gh.repos.get("octocat", "hello-world");

      expect(repository.viewerPermission).toBe("admin");
      expect(mocks.client).toHaveBeenCalledTimes(2);
      expect(mocks.cachedFetch).not.toHaveBeenCalled();
    });

    it("encodes repository path segments before transport", async () => {
      mocks.client.mockResolvedValueOnce(ghRepo);

      await gh.repos.get("octo cat", "hello#world");

      expect(mocks.client).toHaveBeenCalledWith("/repos/octo%20cat/hello%23world");
    });

    it.each([
      "",
      ".",
      "..",
      "../admin",
      "team/admin",
      "team\\admin",
      "%2e%2e",
      "%2Fadmin",
      String.fromCharCode(0),
      String.fromCharCode(10),
      String.fromCharCode(127),
    ])("rejects unsafe repository path segment %j before transport", async (segment) => {
      await expect(gh.repos.get(segment, "hello-world")).rejects.toThrow(
        "Invalid API path segment",
      );
      expect(mocks.client).not.toHaveBeenCalled();
    });
  });

  // --- CI runs ---

  describe("ciRuns.list", () => {
    it("returns normalized paged workflow runs and filters by branch", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: {
          total_count: 12,
          workflow_runs: [ghCiRun, { ...ghCiRun, id: 9877, status: "queued", conclusion: null }],
        },
        headers: makeHeaders(
          '<https://api.github.com/repos/octocat/hello-world/actions/runs?page=3>; rel="next"',
        ),
      });

      const result = await gh.ciRuns.list("octocat", "hello-world", {
        branch: "main",
        page: 2,
        perPage: 10,
      });

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        "/repos/octocat/hello-world/actions/runs",
        { query: { branch: "main", page: "2", per_page: "10" } },
      );
      expect(result).toEqual({
        items: [
          {
            id: "9876",
            branch: "main",
            revision: "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38",
            status: "completed",
            conclusion: "success",
            url: "https://github.com/octocat/hello-world/actions/runs/9876",
          },
          expect.objectContaining({ id: "9877", status: "queued", conclusion: null }),
        ],
        totalCount: 12,
        hasNextPage: true,
        nextPage: 3,
      });
    });
  });

  // --- Issues ---

  describe("issues.list", () => {
    it("returns mapped issues", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [ghIssue],
        headers: makeHeaders(),
      });

      const result = await gh.issues.list("octocat", "hello-world");

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: "1001",
        number: 42,
        title: "Found a bug",
        body: "Something is broken",
        state: "open",
        labels: ["bug", "priority:high"],
        author: { login: "reporter" },
        assignees: [{ login: "triager" }],
        createdAt: "2024-01-15T10:00:00Z",
        updatedAt: "2024-01-16T12:00:00Z",
        url: "https://github.com/octocat/hello-world/issues/42",
      });
    });

    it("passes state filter", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [],
        headers: makeHeaders(),
      });

      await gh.issues.list("octocat", "hello-world", { state: "closed" });

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        "/repos/octocat/hello-world/issues",
        { query: expect.objectContaining({ state: "closed" }) },
      );
    });

    it("filters out pull requests from issues endpoint response", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [
          ghIssue,
          {
            ...ghIssue,
            id: 9999,
            number: 123,
            pull_request: { url: "https://api.github.com/repos/o/r/pulls/123" },
          },
        ],
        headers: makeHeaders(),
      });

      const result = await gh.issues.list("octocat", "hello-world");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].number).toBe(42);
    });
  });

  describe("issues.search", () => {
    it("searches one repository with provider query syntax, state, and pagination", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: {
          items: [
            {
              ...ghIssue,
              state: "closed",
              user: null,
              repository_url: "https://github.example/api/v3/repos/OctoCat/Hello-World",
            },
          ],
          total_count: 1,
          incomplete_results: true,
        },
        headers: makeHeaders('<https://api.github.com/search/issues?q=bug&page=3>; rel="next"'),
      });

      const result = await gh.issues.search("octocat", "hello-world", 'label:"help wanted"', {
        state: "closed",
        page: 2,
        perPage: 1,
      });

      expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/search/issues", {
        query: {
          q: 'label:"help wanted" repo:octocat/hello-world is:issue is:closed',
          page: "2",
          per_page: "1",
        },
      });
      expect(result).toMatchObject({
        items: [
          expect.objectContaining({
            number: 42,
            title: "Found a bug",
            author: { login: "" },
          }),
        ],
        incomplete: true,
        hasNextPage: true,
        nextPage: 3,
      });
    });

    it("marks mixed results partial and keeps only the requested repository, kind, and state", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: {
          items: [
            {
              ...ghIssue,
              repository_url: "https://api.github.com/repos/octocat/hello-world",
            },
            {
              ...ghIssue,
              state: "closed",
              pull_request: { url: "https://api.github.com/repos/octocat/hello-world/pulls/42" },
              repository_url: "https://api.github.com/repos/octocat/hello-world",
            },
            {
              ...ghIssue,
              state: "closed",
              repository_url: "https://api.github.com/repos/octocat/other-repo",
            },
            {
              ...ghIssue,
              id: 1002,
              number: 43,
              state: "closed",
              repository_url: "https://api.github.com/repos/octocat/hello-world",
            },
          ],
          total_count: 4,
          incomplete_results: false,
        },
        headers: makeHeaders(),
      });

      const result = await gh.issues.search(
        "octocat",
        "hello-world",
        "repo:octocat/other-repo OR is:open OR bug",
        { state: "closed" },
      );

      expect(result.items.map((issue) => issue.number)).toEqual([43]);
      expect(result.incomplete).toBe(true);
    });

    it("rejects a blank query before transport", async () => {
      await expect(gh.issues.search("octocat", "hello-world", "   ")).rejects.toThrow(
        "Issue search query must not be empty",
      );
      expect(mocks.rawFetch).not.toHaveBeenCalled();
    });
  });

  describe("issues.get", () => {
    it("returns single mapped issue", async () => {
      mocks.client.mockResolvedValueOnce(ghIssue);

      const issue = await gh.issues.get("octocat", "hello-world", 42);

      expect(mocks.client).toHaveBeenCalledWith("/repos/octocat/hello-world/issues/42");
      expect(issue.number).toBe(42);
      expect(issue.author.login).toBe("reporter");
      expect(issue.assignees).toEqual([{ login: "triager" }]);
      expect(issue.url).toBe("https://github.com/octocat/hello-world/issues/42");
    });

    it("reads current state on every call", async () => {
      const closed = { ...ghIssue, state: "closed", updated_at: "2024-01-17T12:00:00Z" };
      mocks.cachedFetch.mockResolvedValue(ghIssue);
      mocks.client.mockResolvedValueOnce(ghIssue).mockResolvedValueOnce(closed);

      await gh.issues.get("octocat", "hello-world", 42);
      const issue = await gh.issues.get("octocat", "hello-world", 42);

      expect(issue.state).toBe("closed");
      expect(issue.updatedAt).toBe("2024-01-17T12:00:00Z");
      expect(mocks.client).toHaveBeenCalledTimes(2);
      expect(mocks.cachedFetch).not.toHaveBeenCalled();
    });

    it.each([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ])("rejects invalid issue number %s before transport", async (number) => {
      await expect(gh.issues.get("octocat", "hello-world", number)).rejects.toThrow(
        "Invalid API path segment",
      );
      expect(mocks.client).not.toHaveBeenCalled();
    });
  });

  describe("issues.create", () => {
    it("sends POST with correct body", async () => {
      const created = {
        ...ghIssue,
        id: 1002,
        number: 43,
        html_url: "https://github.com/octocat/hello-world/issues/43",
      };
      mocks.client.mockResolvedValueOnce(created);

      const issue = await gh.issues.create("octocat", "hello-world", {
        title: "New bug",
        body: "Details here",
        labels: ["bug"],
        assignees: ["triager"],
      });

      expect(mocks.client).toHaveBeenCalledWith("/repos/octocat/hello-world/issues", {
        method: "POST",
        body: {
          title: "New bug",
          body: "Details here",
          labels: ["bug"],
          assignees: ["triager"],
        },
      });
      expect(issue.number).toBe(43);
      expect(issue.assignees).toEqual([{ login: "triager" }]);
      expect(issue.url).toBe("https://github.com/octocat/hello-world/issues/43");
    });

    it("rejects more than ten assignees before transport", async () => {
      await expect(
        gh.issues.create("octocat", "hello-world", {
          title: "New bug",
          body: "Details here",
          assignees: Array.from({ length: 11 }, (_, index) => `user-${index}`),
        }),
      ).rejects.toThrow("Assignees must be an array of at most 10 non-empty logins");

      expect(mocks.client).not.toHaveBeenCalled();
    });
  });

  describe("issues.listComments", () => {
    it("returns mapped comments with pagination", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [ghComment],
        headers: makeHeaders(
          '<https://api.github.com/repos/octocat/hello-world/issues/42/comments?page=3>; rel="next"',
        ),
      });

      const result = await gh.issues.listComments("octocat", "hello-world", 42, {
        page: 2,
        perPage: 1,
      });

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        "/repos/octocat/hello-world/issues/42/comments",
        { query: { page: "2", per_page: "1" } },
      );
      expect(result.items).toEqual([
        {
          id: "3001",
          body: "Reproduced on 1.2.3 as well",
          author: { login: "commenter" },
          url: "https://github.com/octocat/hello-world/issues/42#issuecomment-3001",
          createdAt: "2024-01-17T09:00:00Z",
          updatedAt: "2024-01-17T09:30:00Z",
        },
      ]);
      expect(result.hasNextPage).toBe(true);
      expect(result.nextPage).toBe(3);
    });

    it("maps a ghost author and missing body to empty strings", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [{ ...ghComment, body: null, user: null }],
        headers: makeHeaders(),
      });

      const result = await gh.issues.listComments("octocat", "hello-world", 42);

      expect(result.items[0]).toMatchObject({ body: "", author: { login: "" } });
    });
  });

  describe("issues.getComment", () => {
    it("reads one comment by id, without the issue number", async () => {
      mocks.client.mockResolvedValueOnce(ghComment);

      const comment = await gh.issues.getComment("octocat", "hello-world", 42, "3001");

      expect(mocks.client).toHaveBeenCalledWith("/repos/octocat/hello-world/issues/comments/3001");
      expect(comment).toMatchObject({ id: "3001", body: "Reproduced on 1.2.3 as well" });
    });

    it("reads the current comment body on every call", async () => {
      const edited = { ...ghComment, body: "Edited after the first read" };
      mocks.cachedFetch.mockResolvedValue(ghComment);
      mocks.client.mockResolvedValueOnce(ghComment).mockResolvedValueOnce(edited);

      await gh.issues.getComment("octocat", "hello-world", 42, "3001");
      const comment = await gh.issues.getComment("octocat", "hello-world", 42, "3001");

      expect(comment.body).toBe("Edited after the first read");
      expect(mocks.client).toHaveBeenCalledTimes(2);
      expect(mocks.cachedFetch).not.toHaveBeenCalled();
    });

    it("answers 404 when the comment belongs to another issue", async () => {
      mocks.client.mockResolvedValueOnce(ghComment);

      await expect(gh.issues.getComment("octocat", "hello-world", 7, "3001")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("skips the association check when the payload omits issue_url", async () => {
      mocks.client.mockResolvedValueOnce({ ...ghComment, issue_url: undefined });

      const comment = await gh.issues.getComment("octocat", "hello-world", 7, "3001");

      expect(comment.id).toBe("3001");
    });
  });

  describe("pullRequests.getComment", () => {
    it("reads the issue-comments endpoint, which carries the PR discussion", async () => {
      mocks.client.mockResolvedValueOnce({
        ...ghComment,
        issue_url: "https://api.github.com/repos/octocat/hello-world/issues/99",
      });

      const comment = await gh.pullRequests.getComment("octocat", "hello-world", 99, "3001");

      expect(mocks.client).toHaveBeenCalledWith("/repos/octocat/hello-world/issues/comments/3001");
      expect(comment.id).toBe("3001");
    });
  });

  // --- Pull Requests ---

  describe("pullRequests.list", () => {
    it("returns mapped pull requests", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [
          {
            ...ghPullRequest,
            mergeable: undefined,
            mergeable_state: undefined,
          },
        ],
        headers: makeHeaders(),
      });

      const result = await gh.pullRequests.list("octocat", "hello-world");

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: "2001",
        number: 99,
        title: "Add dark mode",
        assignees: [{ login: "maintainer" }],
        sourceBranch: "feature/dark-mode",
        targetBranch: "main",
        merged: false,
        draft: true,
        mergeCommitSha: "",
        headSha: "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38",
        mergeable: null,
        mergeStatus: "",
        url: "https://github.com/octocat/hello-world/pull/99",
      });
    });

    it("maps merged list payloads that omit the merged boolean", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [
          {
            ...ghPullRequest,
            merged: undefined,
            merged_at: "2026-08-27T20:34:31Z",
            merge_commit_sha: "850662f475b8c2db88f57f9c3e6901f2e1418c8f",
          },
        ],
        headers: makeHeaders(),
      });

      const result = await gh.pullRequests.list("octocat", "hello-world");

      expect(result.items[0]).toMatchObject({
        merged: true,
        mergeCommitSha: "850662f475b8c2db88f57f9c3e6901f2e1418c8f",
      });
    });
  });

  describe("pullRequests.listChecks", () => {
    it("reads check runs for the pull-request head revision", async () => {
      mocks.client.mockResolvedValueOnce(ghPullRequest);
      mocks.rawFetch.mockResolvedValueOnce({
        data: {
          total_count: 1,
          check_runs: [
            {
              id: 6001,
              name: "test",
              status: "completed",
              conclusion: "success",
              html_url: "https://github.com/octocat/hello-world/runs/6001",
            },
          ],
        },
        headers: makeHeaders(),
      });

      const result = await gh.pullRequests.listChecks("octocat", "hello-world", 99, {
        page: 2,
        perPage: 10,
      });

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        "/repos/octocat/hello-world/commits/cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38/check-runs",
        { query: { page: "2", per_page: "10" } },
      );
      expect(result).toEqual({
        items: [
          {
            id: "6001",
            name: "test",
            status: "completed",
            conclusion: "success",
            url: "https://github.com/octocat/hello-world/runs/6001",
          },
        ],
        totalCount: 1,
        hasNextPage: false,
        nextPage: undefined,
      });
    });
  });

  describe("pullRequests.search", () => {
    it("searches one repository without fetching each pull request", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: {
          items: [
            {
              ...ghIssue,
              state: "closed",
              repository_url: "https://github.example/api/v3/repos/OctoCat/Hello-World",
            },
            {
              ...ghIssue,
              state: "closed",
              repository_url: "https://github.example/api/v3/repos/octocat/other-repo",
              pull_request: {},
            },
            {
              ...ghIssue,
              repository_url: "https://github.example/api/v3/repos/OctoCat/Hello-World",
              pull_request: {},
            },
            {
              ...ghIssue,
              state: "closed",
              html_url: "https://github.com/octocat/hello-world/pull/42",
              repository_url: "https://github.example/api/v3/repos/OctoCat/Hello-World",
              pull_request: { merged_at: "2026-08-28T18:18:56Z" },
              draft: false,
            },
          ],
          incomplete_results: false,
        },
        headers: makeHeaders('<https://api.github.com/search/issues?q=search&page=3>; rel="next"'),
      });

      const result = await gh.pullRequests.search(
        "octocat",
        "hello-world",
        "repo:octocat/other-repo OR is:issue OR search",
        { state: "closed", page: 2, perPage: 1 },
      );

      expect(mocks.rawFetch).toHaveBeenCalledTimes(1);
      expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/search/issues", {
        query: {
          q: "repo:octocat/other-repo OR is:issue OR search repo:octocat/hello-world is:pr is:closed",
          page: "2",
          per_page: "1",
        },
      });
      expect(mocks.client).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        items: [
          {
            number: 42,
            merged: true,
            draft: false,
            url: "https://github.com/octocat/hello-world/pull/42",
          },
        ],
        incomplete: true,
        hasNextPage: true,
        nextPage: 3,
      });
      expect(result.items[0]).not.toHaveProperty("sourceBranch");
      expect(result.items[0]).not.toHaveProperty("headSha");
    });

    it("rejects a blank query before transport", async () => {
      await expect(gh.pullRequests.search("octocat", "hello-world", "   ")).rejects.toThrow(
        "Pull-request search query must not be empty",
      );
      expect(mocks.rawFetch).not.toHaveBeenCalled();
    });
  });

  describe("pullRequests.get", () => {
    it("returns the merge commit SHA for a merged pull request", async () => {
      mocks.client.mockResolvedValueOnce({
        ...ghPullRequest,
        merged: true,
        merge_commit_sha: "0549abd44267f5eb5c6e219fb9ab43b7129aa470",
      });

      const pr = await gh.pullRequests.get("octocat", "hello-world", 99);

      expect(pr.sourceBranch).toBe("feature/dark-mode");
      expect(pr.targetBranch).toBe("main");
      expect(pr.draft).toBe(true);
      expect(pr.assignees).toEqual([{ login: "maintainer" }]);
      expect(pr.mergeCommitSha).toBe("0549abd44267f5eb5c6e219fb9ab43b7129aa470");
      expect(pr.headSha).toBe("cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38");
      expect(pr.mergeable).toBe(true);
      expect(pr.mergeStatus).toBe("blocked");
      expect(pr.url).toBe("https://github.com/octocat/hello-world/pull/99");
    });

    it("preserves unknown mergeability while GitHub computes it", async () => {
      mocks.client.mockResolvedValueOnce({
        ...ghPullRequest,
        mergeable: null,
        mergeable_state: "unknown",
      });

      const pr = await gh.pullRequests.get("octocat", "hello-world", 99);

      expect(pr.mergeable).toBeNull();
      expect(pr.mergeStatus).toBe("unknown");
    });

    it("reads current state on every call", async () => {
      const merged = {
        ...ghPullRequest,
        state: "closed",
        merged: true,
        merged_at: "2024-02-03T09:00:00Z",
        merge_commit_sha: "0549abd44267f5eb5c6e219fb9ab43b7129aa470",
      };
      mocks.cachedFetch.mockResolvedValue(ghPullRequest);
      mocks.client.mockResolvedValueOnce(ghPullRequest).mockResolvedValueOnce(merged);

      await gh.pullRequests.get("octocat", "hello-world", 99);
      const pr = await gh.pullRequests.get("octocat", "hello-world", 99);

      expect(pr.merged).toBe(true);
      expect(pr.mergeCommitSha).toBe("0549abd44267f5eb5c6e219fb9ab43b7129aa470");
      expect(mocks.client).toHaveBeenCalledTimes(2);
      expect(mocks.cachedFetch).not.toHaveBeenCalled();
    });

    it("leaves mergeCommitSha empty when an older payload omits it", async () => {
      mocks.client.mockResolvedValueOnce({ ...ghPullRequest, merge_commit_sha: undefined });

      const pr = await gh.pullRequests.get("octocat", "hello-world", 99);

      expect(pr.mergeCommitSha).toBe("");
    });
  });

  describe("pullRequests.create", () => {
    it("maps branches and assigns the created pull request", async () => {
      mocks.client
        .mockResolvedValueOnce({ ...ghPullRequest, assignees: [] })
        .mockResolvedValueOnce({ ...ghIssue, assignees: [{ login: "maintainer" }] });

      const pr = await gh.pullRequests.create("octocat", "hello-world", {
        title: "Add dark mode",
        body: "Implements it",
        sourceBranch: "feature/dark-mode",
        targetBranch: "main",
        draft: true,
        assignees: ["maintainer"],
      });

      expect(mocks.client).toHaveBeenNthCalledWith(1, "/repos/octocat/hello-world/pulls", {
        method: "POST",
        body: {
          title: "Add dark mode",
          body: "Implements it",
          head: "feature/dark-mode",
          base: "main",
          draft: true,
        },
      });
      expect(mocks.client).toHaveBeenNthCalledWith(
        2,
        "/repos/octocat/hello-world/issues/99/assignees",
        { method: "POST", body: { assignees: ["maintainer"] } },
      );
      expect(pr.assignees).toEqual([{ login: "maintainer" }]);
      expect(pr.url).toBe("https://github.com/octocat/hello-world/pull/99");
    });

    it("returns the created pull request when assignment fails", async () => {
      mocks.client
        .mockResolvedValueOnce({ ...ghPullRequest, assignees: [] })
        .mockRejectedValueOnce(makeFetchError(403));

      const pr = await gh.pullRequests.create("octocat", "hello-world", {
        title: "Add dark mode",
        body: "Implements it",
        sourceBranch: "feature/dark-mode",
        targetBranch: "main",
        assignees: ["maintainer"],
      });

      expect(mocks.client).toHaveBeenCalledTimes(2);
      expect(pr.number).toBe(99);
      expect(pr.assignees).toEqual([]);
    });
  });

  describe("pullRequests.listComments", () => {
    it("reads the issue-comments endpoint, which carries the PR discussion", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [ghComment],
        headers: makeHeaders(),
      });

      const result = await gh.pullRequests.listComments("octocat", "hello-world", 99);

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        "/repos/octocat/hello-world/issues/99/comments",
        { query: {} },
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("3001");
    });
  });

  // --- Users ---

  describe("users.get", () => {
    it("returns mapped user", async () => {
      mocks.client.mockResolvedValueOnce(ghUser);

      const user = await gh.users.get("octocat");

      expect(mocks.client).toHaveBeenCalledWith("/users/octocat");
      expect(user).toMatchObject({
        id: "583231",
        login: "octocat",
        name: "The Octocat",
        email: "octocat@github.com",
        avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
        isAdmin: false,
        bio: "How people build software.",
        company: "@github",
        location: "San Francisco",
        website: "https://github.blog",
        followers: 23753,
        following: 9,
        createdAt: "2011-01-25T18:44:36Z",
        url: "https://github.com/octocat",
      });
    });

    it("reads the current profile on every call", async () => {
      const edited = { ...ghUser, name: "Edited Octocat" };
      mocks.cachedFetch.mockResolvedValue(ghUser);
      mocks.client.mockResolvedValueOnce(ghUser).mockResolvedValueOnce(edited);

      await gh.users.get("octocat");
      const user = await gh.users.get("octocat");

      expect(user.name).toBe("Edited Octocat");
      expect(mocks.client).toHaveBeenCalledTimes(2);
      expect(mocks.cachedFetch).not.toHaveBeenCalled();
    });

    it("defaults profile fields when the payload lacks them, like GitBucket", async () => {
      mocks.client.mockResolvedValueOnce({
        id: 1,
        login: "root",
        name: null,
        email: null,
        avatar_url: "https://gitbucket.example/root/_avatar",
        site_admin: true,
      });

      const user = await gh.users.get("root");

      expect(user).toMatchObject({
        bio: "",
        company: "",
        location: "",
        website: "",
        followers: 0,
        following: 0,
        createdAt: "",
        url: "",
      });
    });
  });

  describe("users.authenticated", () => {
    it("fetches /user endpoint", async () => {
      mocks.client.mockResolvedValueOnce({ ...ghUser, site_admin: true });

      const user = await gh.users.authenticated();

      expect(mocks.client).toHaveBeenCalledWith("/user");
      expect(user.isAdmin).toBe(true);
    });

    it("reads the current authenticated identity on every call", async () => {
      const switched = { ...ghUser, id: 2, login: "monalisa" };
      mocks.cachedFetch.mockResolvedValue(ghUser);
      mocks.client.mockResolvedValueOnce(ghUser).mockResolvedValueOnce(switched);

      await gh.users.authenticated();
      const user = await gh.users.authenticated();

      expect(user.login).toBe("monalisa");
      expect(mocks.client).toHaveBeenCalledTimes(2);
      expect(mocks.cachedFetch).not.toHaveBeenCalled();
    });
  });

  // --- Field Mapping Verification ---

  describe("field mapping (snake_case → camelCase)", () => {
    it("maps full_name → fullName", async () => {
      mocks.client.mockResolvedValueOnce({
        ...ghRepo,
        full_name: "org/my-repo",
      });
      const repo = await gh.repos.get("org", "my-repo");
      expect(repo.fullName).toBe("org/my-repo");
    });

    it("maps avatar_url → avatarUrl", async () => {
      mocks.client.mockResolvedValueOnce(ghRepo);
      const repo = await gh.repos.get("o", "r");
      expect(repo.owner.avatarUrl).toBe("https://avatars.githubusercontent.com/u/1?v=4");
    });

    it("maps default_branch → defaultBranch", async () => {
      mocks.client.mockResolvedValueOnce({
        ...ghRepo,
        default_branch: "develop",
      });
      const repo = await gh.repos.get("o", "r");
      expect(repo.defaultBranch).toBe("develop");
    });

    it("maps html_url → url", async () => {
      mocks.client.mockResolvedValueOnce(ghRepo);
      const repo = await gh.repos.get("o", "r");
      expect(repo.url).toBe("https://github.com/octocat/hello-world");
    });

    it("maps clone_url → cloneUrl", async () => {
      mocks.client.mockResolvedValueOnce(ghRepo);
      const repo = await gh.repos.get("o", "r");
      expect(repo.cloneUrl).toBe("https://github.com/octocat/hello-world.git");
    });

    it("maps site_admin → isAdmin", async () => {
      mocks.client.mockResolvedValueOnce({
        ...ghUser,
        site_admin: true,
      });
      const user = await gh.users.get("admin");
      expect(user.isAdmin).toBe(true);
    });

    it("maps created_at → createdAt and updated_at → updatedAt", async () => {
      mocks.client.mockResolvedValueOnce(ghIssue);
      const issue = await gh.issues.get("o", "r", 42);
      expect(issue.createdAt).toBe("2024-01-15T10:00:00Z");
      expect(issue.updatedAt).toBe("2024-01-16T12:00:00Z");
    });

    it("maps user.login → author.login", async () => {
      mocks.client.mockResolvedValueOnce({
        ...ghIssue,
        user: { login: "specific-user" },
      });
      const issue = await gh.issues.get("o", "r", 1);
      expect(issue.author.login).toBe("specific-user");
    });

    it("maps head.ref → sourceBranch and base.ref → targetBranch", async () => {
      mocks.client.mockResolvedValueOnce({
        ...ghPullRequest,
        head: { ref: "fix/typo" },
        base: { ref: "develop" },
      });
      const pr = await gh.pullRequests.get("o", "r", 1);
      expect(pr.sourceBranch).toBe("fix/typo");
      expect(pr.targetBranch).toBe("develop");
    });

    it("converts numeric id to string", async () => {
      mocks.client.mockResolvedValueOnce({ ...ghRepo, id: 99999 });
      const repo = await gh.repos.get("o", "r");
      expect(repo.id).toBe("99999");
    });

    it("defaults null description to empty string", async () => {
      mocks.client.mockResolvedValueOnce({
        ...ghRepo,
        description: null,
      });
      const repo = await gh.repos.get("o", "r");
      expect(repo.description).toBe("");
    });

    it("defaults null body to empty string", async () => {
      mocks.client.mockResolvedValueOnce({ ...ghIssue, body: null });
      const issue = await gh.issues.get("o", "r", 1);
      expect(issue.body).toBe("");
    });

    it("extracts label names from label objects", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [ghIssue],
        headers: makeHeaders(),
      });
      const result = await gh.issues.list("o", "r");
      expect(result.items[0].labels).toEqual(["bug", "priority:high"]);
    });
  });

  // --- Pagination ---

  describe("pagination", () => {
    it("parses Link header for next page", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [ghRepo],
        headers: makeHeaders(LINK_NEXT_PAGE_2),
      });

      const result = await gh.repos.list("octocat");

      expect(result.hasNextPage).toBe(true);
      expect(result.nextPage).toBe(2);
    });

    it("returns hasNextPage=false when no Link header", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [ghRepo],
        headers: makeHeaders(),
      });

      const result = await gh.repos.list("octocat");

      expect(result.hasNextPage).toBe(false);
      expect(result.nextPage).toBeUndefined();
    });

    it("parses higher page numbers from Link header", async () => {
      const link =
        '<https://api.github.com/repos?page=17>; rel="next", ' +
        '<https://api.github.com/repos?page=42>; rel="last"';
      mocks.rawFetch.mockResolvedValueOnce({
        data: [],
        headers: makeHeaders(link),
      });

      const result = await gh.repos.list("octocat");

      expect(result.nextPage).toBe(17);
    });
  });

  // --- Error Handling ---

  describe("error handling", () => {
    it("throws NotFoundError on 404", async () => {
      mocks.client.mockRejectedValueOnce(makeFetchError(404));
      await expect(gh.repos.get("x", "nonexistent")).rejects.toThrow(NotFoundError);
    });

    it("throws AuthenticationError on 401", async () => {
      mocks.client.mockRejectedValueOnce(makeFetchError(401));
      await expect(gh.users.authenticated()).rejects.toThrow(AuthenticationError);
    });

    it("throws RateLimitError on 429", async () => {
      mocks.rawFetch.mockRejectedValueOnce(makeFetchError(429));
      await expect(gh.repos.list("x")).rejects.toThrow(RateLimitError);
    });

    it("sets platform to github on errors", async () => {
      mocks.client.mockRejectedValueOnce(makeFetchError(500));

      const error = await gh.repos.get("x", "y").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForgesError);
      expect((error as ForgesError).platform).toBe("github");
    });

    it("preserves status code on generic errors", async () => {
      mocks.client.mockRejectedValueOnce(makeFetchError(503));

      const error = await gh.repos.get("x", "y").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForgesError);
      expect((error as ForgesError).status).toBe(503);
    });
  });

  describe("threads", () => {
    it("lists mapped review threads from GraphQL pages", async () => {
      mocks.client.mockResolvedValueOnce(graphqlThreadList([ghThreadNode]));

      const result = await gh.threads.list("octocat", "hello-world", 99);

      expect(mocks.client).toHaveBeenCalledWith("/graphql", {
        method: "POST",
        body: expect.objectContaining({
          variables: expect.objectContaining({
            owner: "octocat",
            name: "hello-world",
            number: 99,
          }),
        }),
      });
      expect(result.items).toEqual([
        {
          id: "PRRT_kwDOA",
          isResolved: false,
          isOutdated: false,
          path: "src/index.ts",
          line: 12,
          startLine: 10,
          comments: [
            {
              id: "9001",
              body: "Please fix this",
              author: { login: "reviewer" },
              url: "https://github.com/octocat/hello-world/pull/99#discussion_r9001",
              createdAt: "2024-02-03T10:00:00Z",
            },
          ],
        },
      ]);
      expect(result.hasNextPage).toBe(false);
    });

    it("walks GraphQL cursors instead of treating one page as complete", async () => {
      const first = { ...ghThreadNode, id: "PRRT_1" };
      const second = { ...ghThreadNode, id: "PRRT_2", isResolved: true };
      mocks.client
        .mockResolvedValueOnce(graphqlThreadList([first], true, "cursor-1"))
        .mockResolvedValueOnce(graphqlThreadList([second]));

      const result = await gh.threads.list("octocat", "hello-world", 99, {
        page: 2,
        perPage: 1,
      });

      expect(mocks.client).toHaveBeenCalledTimes(2);
      expect(result.items.map((thread) => thread.id)).toEqual(["PRRT_2"]);
      expect(result.hasNextPage).toBe(false);
    });

    it("stops when GraphQL reports another page without a cursor", async () => {
      let calls = 0;
      mocks.client.mockImplementation(async () => {
        calls += 1;
        if (calls > 3) {
          throw new Error(`pagination looped ${calls} times`);
        }
        return graphqlThreadList([ghThreadNode], true, null);
      });

      const result = await gh.threads.list("octocat", "hello-world", 99, { perPage: 30 });

      expect(calls).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe("PRRT_kwDOA");
    });

    it("filters unresolved threads across GraphQL pages", async () => {
      mocks.client.mockResolvedValueOnce(
        graphqlThreadList([ghThreadNode, { ...ghThreadNode, id: "PRRT_done", isResolved: true }]),
      );

      const result = await gh.threads.list("octocat", "hello-world", 99, {
        state: "unresolved",
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe("PRRT_kwDOA");
    });

    it("does not advertise a next page when no later thread matches the filter", async () => {
      const resolved = { ...ghThreadNode, id: "PRRT_done", isResolved: true };
      mocks.client
        .mockResolvedValueOnce(graphqlThreadList([ghThreadNode, resolved], true, "cursor-1"))
        .mockResolvedValueOnce(graphqlThreadList([{ ...resolved, id: "PRRT_done2" }]));

      const result = await gh.threads.list("octocat", "hello-world", 99, {
        state: "unresolved",
        perPage: 1,
      });

      expect(mocks.client).toHaveBeenCalledTimes(2);
      expect(result.items.map((thread) => thread.id)).toEqual(["PRRT_kwDOA"]);
      expect(result.hasNextPage).toBe(false);
      expect(result.nextPage).toBeUndefined();
    });

    it("advertises a next page once one more matching thread is found", async () => {
      const second = { ...ghThreadNode, id: "PRRT_second" };
      mocks.client.mockResolvedValueOnce(graphqlThreadList([ghThreadNode, second]));

      const result = await gh.threads.list("octocat", "hello-world", 99, {
        state: "unresolved",
        perPage: 1,
      });

      expect(result.items.map((thread) => thread.id)).toEqual(["PRRT_kwDOA"]);
      expect(result.hasNextPage).toBe(true);
      expect(result.nextPage).toBe(2);
    });

    it("gets one thread by GraphQL id", async () => {
      mocks.client.mockResolvedValueOnce({ data: { node: ghThreadNode } });

      const thread = await gh.threads.get("octocat", "hello-world", 99, "PRRT_kwDOA");

      expect(thread.id).toBe("PRRT_kwDOA");
      expect(thread.comments[0]?.id).toBe("9001");
    });

    it("throws NotFoundError when the thread belongs to another pull request", async () => {
      mocks.client.mockResolvedValueOnce({
        data: {
          node: {
            ...ghThreadNode,
            pullRequest: { ...ghThreadScope, number: 100 },
          },
        },
      });

      await expect(gh.threads.get("octocat", "hello-world", 99, "PRRT_kwDOA")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("throws NotFoundError when the thread belongs to another repository", async () => {
      mocks.client.mockResolvedValueOnce({
        data: {
          node: {
            ...ghThreadNode,
            pullRequest: {
              ...ghThreadScope,
              repository: { name: "other-repo", owner: { login: "octocat" } },
            },
          },
        },
      });

      await expect(gh.threads.get("octocat", "hello-world", 99, "PRRT_kwDOA")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("throws NotFoundError when GraphQL node is missing", async () => {
      mocks.client.mockResolvedValueOnce({ data: { node: null } });

      await expect(gh.threads.get("octocat", "hello-world", 99, "missing")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("throws when GraphQL returns errors even if data is present", async () => {
      mocks.client.mockResolvedValueOnce({
        data: { node: ghThreadNode },
        errors: [{ message: "Something went wrong" }],
      });

      await expect(gh.threads.get("octocat", "hello-world", 99, "PRRT_kwDOA")).rejects.toThrow(
        "Something went wrong",
      );
    });

    it("keeps a 64-bit comment id intact when databaseId overflows", async () => {
      const bigId = "2305843009213693951";
      const node = {
        ...ghThreadNode,
        comments: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              ...ghThreadNode.comments.nodes[0],
              databaseId: null,
              fullDatabaseId: bigId,
            },
          ],
        },
      };
      mocks.client
        .mockResolvedValueOnce({ data: { node } })
        .mockResolvedValueOnce({ data: { node } })
        .mockResolvedValueOnce({
          id: 9002,
          body: "Done.",
          user: { login: "octocat" },
          html_url: "https://github.com/octocat/hello-world/pull/99#discussion_r9002",
          created_at: "2024-02-03T11:00:00Z",
        });

      const thread = await gh.threads.get("octocat", "hello-world", 99, "PRRT_kwDOA");
      expect(thread.comments[0]?.id).toBe(bigId);

      await gh.threads.reply("octocat", "hello-world", 99, "PRRT_kwDOA", { body: "Done." });

      expect(mocks.client).toHaveBeenLastCalledWith(
        `/repos/octocat/hello-world/pulls/99/comments/${bigId}/replies`,
        { method: "POST", body: { body: "Done." } },
      );
    });

    it("replies through the review-comment replies REST endpoint", async () => {
      mocks.client.mockResolvedValueOnce({ data: { node: ghThreadNode } }).mockResolvedValueOnce({
        id: 9002,
        body: "Done.",
        user: { login: "octocat" },
        html_url: "https://github.com/octocat/hello-world/pull/99#discussion_r9002",
        created_at: "2024-02-03T11:00:00Z",
      });

      const comment = await gh.threads.reply("octocat", "hello-world", 99, "PRRT_kwDOA", {
        body: "Done.",
      });

      expect(mocks.client).toHaveBeenLastCalledWith(
        "/repos/octocat/hello-world/pulls/99/comments/9001/replies",
        { method: "POST", body: { body: "Done." } },
      );
      expect(comment.id).toBe("9002");
      expect(comment.body).toBe("Done.");
    });

    it("resolves and unresolves through GraphQL mutations", async () => {
      mocks.client
        .mockResolvedValueOnce({ data: { node: { pullRequest: ghThreadScope } } })
        .mockResolvedValueOnce({
          data: { resolveReviewThread: { thread: { ...ghThreadNode, isResolved: true } } },
        })
        .mockResolvedValueOnce({ data: { node: { pullRequest: ghThreadScope } } })
        .mockResolvedValueOnce({
          data: { unresolveReviewThread: { thread: ghThreadNode } },
        });

      const resolved = await gh.threads.resolve("octocat", "hello-world", 99, "PRRT_kwDOA");
      const unresolved = await gh.threads.unresolve("octocat", "hello-world", 99, "PRRT_kwDOA");

      expect(resolved.isResolved).toBe(true);
      expect(unresolved.isResolved).toBe(false);
    });

    it("refuses to resolve a thread that belongs to another pull request", async () => {
      mocks.client.mockResolvedValueOnce({
        data: { node: { pullRequest: { ...ghThreadScope, number: 100 } } },
      });

      await expect(gh.threads.resolve("octocat", "hello-world", 99, "PRRT_kwDOA")).rejects.toThrow(
        NotFoundError,
      );
      expect(mocks.client).toHaveBeenCalledTimes(1);
    });

    it("reports GraphQL-less hosts instead of a bare 404", async () => {
      const gitbucket = new GitHubProvider({
        baseURL: "https://gitbucket.example.com/api/v3",
        token: "gb_test",
      });
      mocks.client.mockRejectedValueOnce(makeFetchError(404));

      const error = await gitbucket.threads
        .list("octocat", "hello-world", 99)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForgesError);
      expect(error).not.toBeInstanceOf(NotFoundError);
      expect((error as ForgesError).message).toContain("GraphQL");
      expect((error as ForgesError).message).toContain("GitBucket");
    });

    it("posts GraphQL to /api/graphql for GitHub Enterprise REST bases", async () => {
      const enterprise = new GitHubProvider({
        baseURL: "https://git.example.com/api/v3",
        token: "ghp_test",
      });
      mocks.client.mockResolvedValueOnce(graphqlThreadList([]));

      await enterprise.threads.list("octocat", "hello-world", 99);

      expect(mocks.client).toHaveBeenCalledWith("https://git.example.com/api/graphql", {
        method: "POST",
        body: expect.any(Object),
      });
    });
  });
});

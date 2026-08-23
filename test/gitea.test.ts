/**
 * Gitea/Forgejo provider tests
 * Verifies API mapping, `limit` pagination param, and null-safe field handling
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GiteaProvider } from "../src/providers/gitea.ts";
import { Provider } from "../src/provider.ts";
import { NotFoundError } from "../src/errors.ts";

// -- Mock HTTP layer --

const mockRawResponse = {
  data: [] as unknown[],
  headers: new Headers(),
  status: 200,
};

const mockClient = vi.fn().mockResolvedValue({});

vi.mock("../src/http.ts", () => ({
  createHttpClient: vi.fn(() => mockClient),
  rawFetch: vi.fn(async (_client: unknown, _url: string, _opts?: unknown) => ({
    ...mockRawResponse,
  })),
}));

vi.mock("../src/cache.ts", () => ({
  cachedFetch: vi.fn(async (client: (...args: unknown[]) => unknown, url: string, opts?: unknown) =>
    opts ? client(url, opts) : client(url),
  ),
}));

// Import mocked modules to control them
import { rawFetch } from "../src/http.ts";
import { createHttpClient } from "../src/http.ts";
import { FetchError } from "ofetch";

const mockedRawFetch = vi.mocked(rawFetch);
const mockedCreateHttpClient = vi.mocked(createHttpClient);

// -- Gitea API fixture data --

function giteaUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    login: "testuser",
    full_name: "Test User",
    email: "test@example.com",
    avatar_url: "https://gitea.com/avatars/42",
    is_admin: false,
    ...overrides,
  };
}

function giteaOwner(overrides: Record<string, unknown> = {}) {
  return {
    login: "testowner",
    avatar_url: "https://gitea.com/avatars/1",
    ...overrides,
  };
}

function giteaRepo(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    name: "test-repo",
    full_name: "testowner/test-repo",
    description: "A test repository",
    private: false,
    default_branch: "main",
    html_url: "https://gitea.com/testowner/test-repo",
    clone_url: "https://gitea.com/testowner/test-repo.git",
    owner: giteaOwner(),
    ...overrides,
  };
}

function giteaIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 200,
    number: 1,
    title: "Test issue",
    body: "Issue body text",
    state: "open",
    labels: [{ id: 1, name: "bug" }],
    user: giteaUser(),
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    ...overrides,
  };
}

function giteaPullRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 300,
    number: 5,
    title: "Test PR",
    body: "PR body text",
    state: "open",
    labels: [{ id: 2, name: "enhancement" }],
    user: giteaUser(),
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    head: { ref: "feature-branch", label: "testowner:feature-branch" },
    base: { ref: "main", label: "testowner:main" },
    merged: false,
    draft: false,
    ...overrides,
  };
}

function giteaReviewComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    body: "Please rename this",
    user: giteaUser(),
    html_url: "https://gitea.com/testowner/test-repo/pulls/5#issuecomment-11",
    created_at: "2024-01-03T00:00:00Z",
    path: "src/main.ts",
    position: 8,
    original_position: 8,
    resolver: null,
    ...overrides,
  };
}

function giteaComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 21,
    body: "Same here on 1.22",
    user: giteaUser(),
    html_url: "https://gitea.com/testowner/test-repo/issues/1#issuecomment-21",
    created_at: "2024-01-04T00:00:00Z",
    updated_at: "2024-01-04T01:00:00Z",
    ...overrides,
  };
}

function makeHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers(extra);
}

function linkHeader(
  page: number,
  limit: number,
  base = "https://gitea.com/api/v1/users/testowner/repos",
): string {
  return `<${base}?page=${page}&limit=${limit}>; rel="next"`;
}

// -- Tests --

describe("Gitea Provider", () => {
  let provider: Provider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GiteaProvider({ token: "test-token" });
  });

  describe("provider setup", () => {
    it("extends the abstract Provider base class", () => {
      expect(provider).toBeInstanceOf(Provider);
    });

    it("defaults to the public API base URL", () => {
      expect(mockedCreateHttpClient).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: "https://gitea.com/api/v1" }),
      );
    });

    it("defaults to the public API base URL when baseURL is empty", () => {
      new GiteaProvider({ baseURL: "", token: "test-token" });

      expect(mockedCreateHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: "https://gitea.com/api/v1" }),
      );
    });

    it("appends /api/v1 for root instance URLs", () => {
      new GiteaProvider({ baseURL: "https://codeberg.org", token: "test-token" });

      expect(mockedCreateHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: "https://codeberg.org/api/v1" }),
      );
    });

    it("appends /api/v1 for subpath instance URLs with trailing slash", () => {
      new GiteaProvider({ baseURL: "https://codeberg.org/forgejo/", token: "test-token" });

      expect(mockedCreateHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: "https://codeberg.org/forgejo/api/v1" }),
      );
    });

    it("preserves already-prefixed api URLs", () => {
      new GiteaProvider({ baseURL: "https://codeberg.org/api/v1", token: "test-token" });

      expect(mockedCreateHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: "https://codeberg.org/api/v1" }),
      );
    });

    it("preserves already-prefixed api URLs under a subpath", () => {
      new GiteaProvider({ baseURL: "https://codeberg.org/forgejo/api/v1", token: "test-token" });

      expect(mockedCreateHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: "https://codeberg.org/forgejo/api/v1" }),
      );
    });

    it("does not treat api paths with extra trailing segments as already prefixed", () => {
      new GiteaProvider({
        baseURL: "https://codeberg.org/custom/api/v1/proxy",
        token: "test-token",
      });

      expect(mockedCreateHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: "https://codeberg.org/custom/api/v1/proxy/api/v1" }),
      );
    });
  });

  // --- repos ---

  describe("repos.list", () => {
    it("returns mapped repositories", async () => {
      mockedRawFetch.mockResolvedValueOnce({
        data: [giteaRepo(), giteaRepo({ id: 101, name: "repo-2", full_name: "testowner/repo-2" })],
        headers: makeHeaders(),
        status: 200,
      });

      const result = await provider.repos.list("testowner");

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        id: "100",
        name: "test-repo",
        fullName: "testowner/test-repo",
        description: "A test repository",
        private: false,
        defaultBranch: "main",
        url: "https://gitea.com/testowner/test-repo",
        cloneUrl: "https://gitea.com/testowner/test-repo.git",
        owner: { login: "testowner", avatarUrl: "https://gitea.com/avatars/1" },
      });
      expect(result.items[1].id).toBe("101");
    });

    it("uses limit param instead of per_page", async () => {
      mockedRawFetch.mockResolvedValueOnce({
        data: [],
        headers: makeHeaders(),
        status: 200,
      });

      await provider.repos.list("testowner", { perPage: 50 });

      expect(mockedRawFetch).toHaveBeenCalledWith(expect.anything(), "/users/testowner/repos", {
        query: { limit: "50" },
      });
    });

    it("passes page parameter", async () => {
      mockedRawFetch.mockResolvedValueOnce({
        data: [],
        headers: makeHeaders(),
        status: 200,
      });

      await provider.repos.list("testowner", { page: 3, perPage: 10 });

      expect(mockedRawFetch).toHaveBeenCalledWith(expect.anything(), "/users/testowner/repos", {
        query: { page: "3", limit: "10" },
      });
    });

    it("parses Link header for pagination", async () => {
      mockedRawFetch.mockResolvedValueOnce({
        data: [giteaRepo()],
        headers: makeHeaders({ Link: linkHeader(2, 30) }),
        status: 200,
      });

      const result = await provider.repos.list("testowner");

      expect(result.hasNextPage).toBe(true);
      expect(result.nextPage).toBe(2);
    });

    it("handles empty results", async () => {
      mockedRawFetch.mockResolvedValueOnce({
        data: [],
        headers: makeHeaders(),
        status: 200,
      });

      const result = await provider.repos.list("testowner");

      expect(result.items).toHaveLength(0);
      expect(result.hasNextPage).toBe(false);
    });
  });

  describe("repos.get", () => {
    it("returns a mapped repository", async () => {
      mockClient.mockResolvedValueOnce(giteaRepo());

      const result = await provider.repos.get("testowner", "test-repo");

      expect(result.id).toBe("100");
      expect(result.fullName).toBe("testowner/test-repo");
      expect(result.owner.login).toBe("testowner");
      expect(mockClient).toHaveBeenCalledWith("/repos/testowner/test-repo");
    });

    it("encodes repository path segments before transport", async () => {
      mockClient.mockResolvedValueOnce(giteaRepo());

      await provider.repos.get("test owner", "test#repo");

      expect(mockClient).toHaveBeenCalledWith("/repos/test%20owner/test%23repo");
    });

    it.each(["", ".", "..", "../admin", "team/admin", "team\\admin", "%2e%2e", "%2Fadmin"])(
      "rejects unsafe repository path segment %j before transport",
      async (segment) => {
        await expect(provider.repos.get(segment, "test-repo")).rejects.toThrow(
          "Invalid API path segment",
        );
        expect(mockClient).not.toHaveBeenCalled();
      },
    );
  });

  // --- issues ---

  describe("issues.list", () => {
    it("returns mapped issues", async () => {
      mockedRawFetch.mockResolvedValueOnce({
        data: [giteaIssue()],
        headers: makeHeaders(),
        status: 200,
      });

      const result = await provider.issues.list("testowner", "test-repo");

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        id: "200",
        number: 1,
        title: "Test issue",
        body: "Issue body text",
        state: "open",
        labels: ["bug"],
        author: { login: "testuser" },
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      });
    });

    it("uses limit param and includes type=issues filter", async () => {
      mockedRawFetch.mockResolvedValueOnce({
        data: [],
        headers: makeHeaders(),
        status: 200,
      });

      await provider.issues.list("testowner", "test-repo", { perPage: 25 });

      expect(mockedRawFetch).toHaveBeenCalledWith(
        expect.anything(),
        "/repos/testowner/test-repo/issues",
        { query: expect.objectContaining({ limit: "25", type: "issues" }) },
      );
    });

    it("passes state filter", async () => {
      mockedRawFetch.mockResolvedValueOnce({
        data: [],
        headers: makeHeaders(),
        status: 200,
      });

      await provider.issues.list("testowner", "test-repo", { state: "closed" });

      expect(mockedRawFetch).toHaveBeenCalledWith(
        expect.anything(),
        "/repos/testowner/test-repo/issues",
        { query: expect.objectContaining({ state: "closed", type: "issues" }) },
      );
    });
  });

  describe("issues.get", () => {
    it("returns a mapped issue", async () => {
      mockClient.mockResolvedValueOnce(giteaIssue());

      const result = await provider.issues.get("testowner", "test-repo", 1);

      expect(result.id).toBe("200");
      expect(result.number).toBe(1);
      expect(result.state).toBe("open");
      expect(result.labels).toEqual(["bug"]);
      expect(result.author.login).toBe("testuser");
    });
  });

  describe("issues.create", () => {
    it("creates and returns a mapped issue", async () => {
      mockClient.mockResolvedValueOnce(giteaIssue({ id: 201, number: 2, title: "New issue" }));

      const result = await provider.issues.create("testowner", "test-repo", {
        title: "New issue",
        body: "Issue body",
      });

      expect(result.id).toBe("201");
      expect(result.number).toBe(2);
      expect(result.title).toBe("New issue");
      expect(mockClient).toHaveBeenCalledWith(
        "/repos/testowner/test-repo/issues",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ title: "New issue", body: "Issue body" }),
        }),
      );
    });

    it("includes labels when provided", async () => {
      mockClient.mockResolvedValueOnce(
        giteaIssue({
          labels: [
            { id: 1, name: "bug" },
            { id: 2, name: "urgent" },
          ],
        }),
      );

      await provider.issues.create("testowner", "test-repo", {
        title: "Bug report",
        body: "Critical bug",
        labels: ["bug", "urgent"],
      });

      expect(mockClient).toHaveBeenCalledWith(
        "/repos/testowner/test-repo/issues",
        expect.objectContaining({
          body: expect.objectContaining({ labels: ["bug", "urgent"] }),
        }),
      );
    });
  });

  // --- pullRequests ---

  describe("pullRequests.list", () => {
    it("returns mapped pull requests", async () => {
      mockedRawFetch.mockResolvedValueOnce({
        data: [giteaPullRequest()],
        headers: makeHeaders(),
        status: 200,
      });

      const result = await provider.pullRequests.list("testowner", "test-repo");

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        id: "300",
        number: 5,
        title: "Test PR",
        body: "PR body text",
        state: "open",
        labels: ["enhancement"],
        author: { login: "testuser" },
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        sourceBranch: "feature-branch",
        targetBranch: "main",
        merged: false,
        draft: false,
      });
    });

    it("uses limit param for pagination", async () => {
      mockedRawFetch.mockResolvedValueOnce({
        data: [],
        headers: makeHeaders(),
        status: 200,
      });

      await provider.pullRequests.list("testowner", "test-repo", { perPage: 15 });

      expect(mockedRawFetch).toHaveBeenCalledWith(
        expect.anything(),
        "/repos/testowner/test-repo/pulls",
        { query: { limit: "15" } },
      );
    });
  });

  describe("pullRequests.get", () => {
    it("returns a mapped pull request", async () => {
      mockClient.mockResolvedValueOnce(giteaPullRequest());

      const result = await provider.pullRequests.get("testowner", "test-repo", 5);

      expect(result.id).toBe("300");
      expect(result.sourceBranch).toBe("feature-branch");
      expect(result.targetBranch).toBe("main");
      expect(result.merged).toBe(false);
      expect(result.draft).toBe(false);
    });
  });

  describe("pullRequests.create", () => {
    it("creates a pull request with head/base params", async () => {
      mockClient.mockResolvedValueOnce(giteaPullRequest({ id: 301 }));

      const result = await provider.pullRequests.create("testowner", "test-repo", {
        title: "New PR",
        body: "PR body",
        sourceBranch: "feature",
        targetBranch: "main",
      });

      expect(result.id).toBe("301");
      expect(mockClient).toHaveBeenCalledWith(
        "/repos/testowner/test-repo/pulls",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            title: "New PR",
            head: "feature",
            base: "main",
          }),
        }),
      );
    });

    it("includes draft field in request body when specified", async () => {
      mockClient.mockResolvedValueOnce(giteaPullRequest({ id: 302 }));

      await provider.pullRequests.create("testowner", "test-repo", {
        title: "Draft PR",
        body: "WIP",
        sourceBranch: "wip-branch",
        targetBranch: "main",
        draft: true,
      });

      expect(mockClient).toHaveBeenCalledWith(
        "/repos/testowner/test-repo/pulls",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            title: "Draft PR",
            head: "wip-branch",
            base: "main",
            draft: true,
          }),
        }),
      );
    });
  });

  // --- comments ---

  describe("issues.listComments", () => {
    it("cuts the requested page locally because the route ignores paging", async () => {
      mockedRawFetch.mockResolvedValueOnce({
        data: [giteaComment(), giteaComment({ id: 22 }), giteaComment({ id: 23 })],
        headers: makeHeaders(),
        status: 200,
      });

      const result = await provider.issues.listComments("testowner", "test-repo", 1, {
        perPage: 2,
      });

      expect(mockedRawFetch).toHaveBeenCalledWith(
        mockClient,
        "/repos/testowner/test-repo/issues/1/comments",
        { query: { page: "1", limit: "50" } },
      );
      expect(result.items.map((comment) => comment.id)).toEqual(["21", "22"]);
      expect(result.items[0]).toMatchObject({
        body: "Same here on 1.22",
        author: { login: "testuser" },
        url: "https://gitea.com/testowner/test-repo/issues/1#issuecomment-21",
        createdAt: "2024-01-04T00:00:00Z",
        updatedAt: "2024-01-04T01:00:00Z",
      });
      expect(result.hasNextPage).toBe(true);
      expect(result.nextPage).toBe(2);
    });

    it("serves a later page from the same response", async () => {
      mockedRawFetch.mockResolvedValueOnce({
        data: [giteaComment(), giteaComment({ id: 22 }), giteaComment({ id: 23 })],
        headers: makeHeaders(),
        status: 200,
      });

      const result = await provider.issues.listComments("testowner", "test-repo", 1, {
        page: 2,
        perPage: 2,
      });

      expect(result.items.map((comment) => comment.id)).toEqual(["23"]);
      expect(result.hasNextPage).toBe(false);
      expect(result.nextPage).toBeUndefined();
    });

    it("follows the Link header and restores oldest-first order across batches", async () => {
      mockedRawFetch
        .mockResolvedValueOnce({
          data: [giteaComment()],
          headers: makeHeaders({
            Link: linkHeader(
              2,
              50,
              "https://gitea.com/api/v1/repos/testowner/test-repo/issues/1/comments",
            ),
          }),
          status: 200,
        })
        .mockResolvedValueOnce({
          data: [giteaComment({ id: 20 })],
          headers: makeHeaders(),
          status: 200,
        });

      const result = await provider.issues.listComments("testowner", "test-repo", 1);

      expect(mockedRawFetch).toHaveBeenCalledTimes(2);
      expect(result.items.map((comment) => comment.id)).toEqual(["20", "21"]);
    });

    it("stops walking remote pages once the requested slice is full", async () => {
      const commentsBase = "https://gitea.com/api/v1/repos/testowner/test-repo/issues/1/comments";
      mockedRawFetch
        .mockResolvedValueOnce({
          data: [giteaComment()],
          headers: makeHeaders({ Link: linkHeader(2, 50, commentsBase) }),
          status: 200,
        })
        .mockResolvedValueOnce({
          data: [giteaComment({ id: 22 })],
          headers: makeHeaders({ Link: linkHeader(3, 50, commentsBase) }),
          status: 200,
        });

      const result = await provider.issues.listComments("testowner", "test-repo", 1, {
        perPage: 1,
      });

      expect(mockedRawFetch).toHaveBeenCalledTimes(2);
      expect(result.items.map((comment) => comment.id)).toEqual(["21"]);
      expect(result.hasNextPage).toBe(true);
      expect(result.nextPage).toBe(2);
    });
  });

  describe("pullRequests.listComments", () => {
    it("reads the shared issue-comments route", async () => {
      mockedRawFetch.mockResolvedValueOnce({
        data: [giteaComment()],
        headers: makeHeaders(),
        status: 200,
      });

      const result = await provider.pullRequests.listComments("testowner", "test-repo", 5);

      expect(mockedRawFetch).toHaveBeenCalledWith(
        mockClient,
        "/repos/testowner/test-repo/issues/5/comments",
        { query: { page: "1", limit: "50" } },
      );
      expect(result.items).toHaveLength(1);
    });
  });

  // --- users ---

  describe("users.get", () => {
    it("returns a mapped user", async () => {
      mockClient.mockResolvedValueOnce(giteaUser());

      const result = await provider.users.get("testuser");

      expect(result).toEqual({
        id: "42",
        login: "testuser",
        name: "Test User",
        email: "test@example.com",
        avatarUrl: "https://gitea.com/avatars/42",
        isAdmin: false,
      });
    });
  });

  describe("users.authenticated", () => {
    it("returns the authenticated user", async () => {
      mockClient.mockResolvedValueOnce(giteaUser({ is_admin: true }));

      const result = await provider.users.authenticated();

      expect(result.isAdmin).toBe(true);
      expect(mockClient).toHaveBeenCalledWith("/user");
    });
  });

  // --- Null-safe field handling ---

  describe("null-safe field handling", () => {
    it("handles null description on repository", async () => {
      mockClient.mockResolvedValueOnce(giteaRepo({ description: null }));

      const result = await provider.repos.get("testowner", "test-repo");
      expect(result.description).toBe("");
    });

    it("handles null default_branch on repository", async () => {
      mockClient.mockResolvedValueOnce(giteaRepo({ default_branch: null }));

      const result = await provider.repos.get("testowner", "test-repo");
      expect(result.defaultBranch).toBe("main");
    });

    it("handles null html_url and clone_url on repository", async () => {
      mockClient.mockResolvedValueOnce(giteaRepo({ html_url: null, clone_url: null }));

      const result = await provider.repos.get("testowner", "test-repo");
      expect(result.url).toBe("");
      expect(result.cloneUrl).toBe("");
    });

    it("handles null avatar_url on owner", async () => {
      mockClient.mockResolvedValueOnce(
        giteaRepo({
          owner: { login: "testowner", avatar_url: null },
        }),
      );

      const result = await provider.repos.get("testowner", "test-repo");
      expect(result.owner.avatarUrl).toBe("");
    });

    it("handles null body on issue", async () => {
      mockClient.mockResolvedValueOnce(giteaIssue({ body: null }));

      const result = await provider.issues.get("testowner", "test-repo", 1);
      expect(result.body).toBe("");
    });

    it("handles null labels on issue", async () => {
      mockClient.mockResolvedValueOnce(giteaIssue({ labels: null }));

      const result = await provider.issues.get("testowner", "test-repo", 1);
      expect(result.labels).toEqual([]);
    });

    it("handles null head/base refs on pull request", async () => {
      mockClient.mockResolvedValueOnce(
        giteaPullRequest({
          head: null,
          base: null,
        }),
      );

      const result = await provider.pullRequests.get("testowner", "test-repo", 5);
      expect(result.sourceBranch).toBe("");
      expect(result.targetBranch).toBe("");
    });

    it("handles null ref inside head/base on pull request", async () => {
      mockClient.mockResolvedValueOnce(
        giteaPullRequest({
          head: { ref: null, label: null },
          base: { ref: null, label: null },
        }),
      );

      const result = await provider.pullRequests.get("testowner", "test-repo", 5);
      expect(result.sourceBranch).toBe("");
      expect(result.targetBranch).toBe("");
    });

    it("handles null user fields", async () => {
      mockClient.mockResolvedValueOnce(
        giteaUser({
          full_name: null,
          email: null,
          avatar_url: null,
        }),
      );

      const result = await provider.users.get("testuser");
      expect(result.name).toBe("");
      expect(result.email).toBe("");
      expect(result.avatarUrl).toBe("");
    });

    it("handles undefined merged and draft on pull request", async () => {
      mockClient.mockResolvedValueOnce(
        giteaPullRequest({
          merged: undefined,
          draft: undefined,
        }),
      );

      const result = await provider.pullRequests.get("testowner", "test-repo", 5);
      expect(result.merged).toBe(false);
      expect(result.draft).toBe(false);
    });
  });

  // --- Error handling ---

  describe("error handling", () => {
    it("wraps errors with normalizeError", async () => {
      const fetchErr = new FetchError("Not Found");
      fetchErr.status = 404;
      mockClient.mockRejectedValueOnce(fetchErr);

      await expect(provider.repos.get("bad", "repo")).rejects.toThrow();
    });

    it("wraps list errors with normalizeError", async () => {
      const fetchErr = new FetchError("Unauthorized");
      fetchErr.status = 401;
      mockedRawFetch.mockRejectedValueOnce(fetchErr);

      await expect(provider.repos.list("bad")).rejects.toThrow();
    });
  });

  // --- ID normalization ---

  describe("ID normalization", () => {
    it("converts numeric IDs to strings for repos", async () => {
      mockClient.mockResolvedValueOnce(giteaRepo({ id: 999 }));

      const result = await provider.repos.get("testowner", "test-repo");
      expect(result.id).toBe("999");
      expect(typeof result.id).toBe("string");
    });

    it("converts numeric IDs to strings for issues", async () => {
      mockClient.mockResolvedValueOnce(giteaIssue({ id: 888 }));

      const result = await provider.issues.get("testowner", "test-repo", 1);
      expect(result.id).toBe("888");
      expect(typeof result.id).toBe("string");
    });

    it("converts numeric IDs to strings for users", async () => {
      mockClient.mockResolvedValueOnce(giteaUser({ id: 777 }));

      const result = await provider.users.get("testuser");
      expect(result.id).toBe("777");
      expect(typeof result.id).toBe("string");
    });
  });

  // --- State mapping ---

  describe("state mapping", () => {
    it("maps open state correctly for issues", async () => {
      mockClient.mockResolvedValueOnce(giteaIssue({ state: "open" }));
      const result = await provider.issues.get("testowner", "test-repo", 1);
      expect(result.state).toBe("open");
    });

    it("maps closed state correctly for issues", async () => {
      mockClient.mockResolvedValueOnce(giteaIssue({ state: "closed" }));
      const result = await provider.issues.get("testowner", "test-repo", 1);
      expect(result.state).toBe("closed");
    });

    it("maps non-open state to closed for pull requests", async () => {
      mockClient.mockResolvedValueOnce(giteaPullRequest({ state: "closed", merged: true }));
      const result = await provider.pullRequests.get("testowner", "test-repo", 5);
      expect(result.state).toBe("closed");
      expect(result.merged).toBe(true);
    });
  });

  describe("threads", () => {
    it("lists each review comment as its own thread", async () => {
      mockedRawFetch
        .mockResolvedValueOnce({
          data: [{ id: 1, comments_count: 2 }],
          headers: makeHeaders(),
          status: 200,
        })
        .mockResolvedValueOnce({
          data: [
            giteaReviewComment({ id: 11 }),
            giteaReviewComment({ id: 12, body: "Independent comment on the same line" }),
          ],
          headers: makeHeaders(),
          status: 200,
        });

      const result = await provider.threads.list("testowner", "test-repo", 5);

      expect(result.items).toHaveLength(2);
      expect(result.items.map((thread) => thread.id)).toEqual(["11", "12"]);
      expect(result.items[0]?.isOutdated).toBe(false);
      expect(result.items[0]?.comments).toHaveLength(1);
      expect(result.items[1]?.comments[0]?.body).toBe("Independent comment on the same line");
    });

    it("stops review pagination when a page is empty even if Link next exists", async () => {
      let calls = 0;
      mockedRawFetch.mockImplementation(async () => {
        calls += 1;
        if (calls > 3) {
          throw new Error(`pagination looped ${calls} times`);
        }
        return {
          data: [],
          headers: makeHeaders({
            Link: '<https://gitea.com/api/v1/repos/testowner/test-repo/pulls/5/reviews?page=2>; rel="next"',
          }),
          status: 200,
        };
      });

      const result = await provider.threads.list("testowner", "test-repo", 5);

      expect(calls).toBe(1);
      expect(result.items).toEqual([]);
    });

    it("replies through the review-comment replies endpoint without scanning reviews", async () => {
      mockClient.mockResolvedValueOnce(giteaReviewComment({ id: 13, body: "Renamed." }));

      const comment = await provider.threads.reply("testowner", "test-repo", 5, "11", {
        body: "Renamed.",
      });

      expect(mockedRawFetch).not.toHaveBeenCalled();
      expect(mockClient).toHaveBeenLastCalledWith(
        "/repos/testowner/test-repo/pulls/5/comments/11/replies",
        { method: "POST", body: { body: "Renamed." } },
      );
      expect(comment.id).toBe("13");
    });

    it("resolves a review comment conversation with a single read-back scan", async () => {
      mockedRawFetch
        .mockResolvedValueOnce({
          data: [{ id: 1, comments_count: 1 }],
          headers: makeHeaders(),
          status: 200,
        })
        .mockResolvedValueOnce({
          data: [giteaReviewComment({ id: 11 })],
          headers: makeHeaders(),
          status: 200,
        });
      mockClient.mockResolvedValueOnce(undefined);

      const thread = await provider.threads.resolve("testowner", "test-repo", 5, "11");

      expect(mockClient).toHaveBeenCalledWith(
        "/repos/testowner/test-repo/pulls/comments/11/resolve",
        {
          method: "POST",
        },
      );
      expect(mockedRawFetch).toHaveBeenCalledTimes(2);
      expect(thread.isResolved).toBe(true);
    });

    it("unresolves through the unresolve action", async () => {
      mockedRawFetch
        .mockResolvedValueOnce({
          data: [{ id: 1, comments_count: 1 }],
          headers: makeHeaders(),
          status: 200,
        })
        .mockResolvedValueOnce({
          data: [giteaReviewComment({ id: 11 })],
          headers: makeHeaders(),
          status: 200,
        });
      mockClient.mockResolvedValueOnce(undefined);

      const thread = await provider.threads.unresolve("testowner", "test-repo", 5, "11");

      expect(mockClient).toHaveBeenCalledWith(
        "/repos/testowner/test-repo/pulls/comments/11/unresolve",
        { method: "POST" },
      );
      expect(thread.isResolved).toBe(false);
    });

    it("refuses to resolve a comment that does not sit on this pull request", async () => {
      mockedRawFetch
        .mockResolvedValueOnce({
          data: [{ id: 1, comments_count: 1 }],
          headers: makeHeaders(),
          status: 200,
        })
        .mockResolvedValueOnce({
          data: [giteaReviewComment({ id: 11 })],
          headers: makeHeaders(),
          status: 200,
        });

      await expect(provider.threads.resolve("testowner", "test-repo", 5, "999")).rejects.toThrow(
        NotFoundError,
      );
      expect(mockClient).not.toHaveBeenCalled();
    });

    it("paginates comments inside a single review", async () => {
      mockedRawFetch
        .mockResolvedValueOnce({
          data: [{ id: 1, comments_count: 2 }],
          headers: makeHeaders(),
          status: 200,
        })
        .mockResolvedValueOnce({
          data: [giteaReviewComment({ id: 11 })],
          headers: makeHeaders({
            Link: '<https://gitea.com/api/v1/repos/testowner/test-repo/pulls/5/reviews/1/comments?page=2>; rel="next"',
          }),
          status: 200,
        })
        .mockResolvedValueOnce({
          data: [giteaReviewComment({ id: 12, body: "Second page comment" })],
          headers: makeHeaders(),
          status: 200,
        });

      const result = await provider.threads.list("testowner", "test-repo", 5);

      expect(result.items.map((thread) => thread.id)).toEqual(["11", "12"]);
      expect(mockedRawFetch).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        "/repos/testowner/test-repo/pulls/5/reviews/1/comments",
        { query: { page: "1", limit: "50" } },
      );
    });

    it("stops comment pagination when a page is empty even if Link next exists", async () => {
      mockedRawFetch
        .mockResolvedValueOnce({
          data: [{ id: 1, comments_count: 1 }],
          headers: makeHeaders(),
          status: 200,
        })
        .mockResolvedValue({
          data: [],
          headers: makeHeaders({
            Link: '<https://gitea.com/api/v1/repos/testowner/test-repo/pulls/5/reviews/1/comments?page=2>; rel="next"',
          }),
          status: 200,
        });

      const result = await provider.threads.list("testowner", "test-repo", 5);

      expect(result.items).toEqual([]);
      expect(mockedRawFetch).toHaveBeenCalledTimes(2);
    });

    it("reads the old-file line when a comment sits on the removed side", async () => {
      mockedRawFetch
        .mockResolvedValueOnce({
          data: [{ id: 1, comments_count: 1 }],
          headers: makeHeaders(),
          status: 200,
        })
        .mockResolvedValueOnce({
          data: [giteaReviewComment({ id: 11, position: 0, original_position: 8 })],
          headers: makeHeaders(),
          status: 200,
        });

      const result = await provider.threads.list("testowner", "test-repo", 5);

      // Gitea does not expose its internal outdated flag, so it stays false.
      expect(result.items[0]?.isOutdated).toBe(false);
      expect(result.items[0]?.line).toBe(8);
    });

    it("leaves line null when neither side carries a line number", async () => {
      mockedRawFetch
        .mockResolvedValueOnce({
          data: [{ id: 1, comments_count: 1 }],
          headers: makeHeaders(),
          status: 200,
        })
        .mockResolvedValueOnce({
          data: [giteaReviewComment({ id: 11, position: 0, original_position: 0 })],
          headers: makeHeaders(),
          status: 200,
        });

      const result = await provider.threads.list("testowner", "test-repo", 5);

      expect(result.items[0]?.isOutdated).toBe(false);
      expect(result.items[0]?.line).toBeNull();
    });
  });
});

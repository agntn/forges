import { describe, it, expect, beforeEach, vi } from "vitest";
import { FetchError } from "ofetch";
import { NotFoundError, AuthenticationError, RateLimitError, ForgesError } from "../src/errors.ts";

// --- Hoisted mocks ---

const mocks = vi.hoisted(() => {
  const client = vi.fn();
  const cachedFetch = vi.fn((_client: unknown, url: string, opts?: unknown) =>
    opts ? client(url, opts) : client(url),
  );
  return {
    client,
    cachedFetch,
    invalidateCache: vi.fn(),
    createHttpClient: vi.fn(() => client),
    rawFetch: vi.fn(),
  };
});

vi.mock("../src/http.ts", () => ({
  createHttpClient: mocks.createHttpClient,
  rawFetch: mocks.rawFetch,
  FetchError,
}));

vi.mock("../src/cache.ts", () => ({
  cachedFetch: mocks.cachedFetch,
  invalidateCache: mocks.invalidateCache,
}));

import { GitLabProvider } from "../src/providers/gitlab.ts";

// --- Fixtures (matching real GitLab API v4 responses) ---

const glProject = {
  id: 278964,
  name: "gitlab-foss",
  path_with_namespace: "gitlab-org/gitlab-foss",
  description: "GitLab FOSS mirror",
  visibility: "public",
  default_branch: "master",
  web_url: "https://gitlab.com/gitlab-org/gitlab-foss",
  http_url_to_repo: "https://gitlab.com/gitlab-org/gitlab-foss.git",
  namespace: {
    path: "gitlab-org",
    avatar_url: "https://gitlab.com/uploads/-/system/group/avatar/9970/logo.png",
  },
  owner: undefined as { username: string; avatar_url: string | null } | undefined,
};

const glProjectWithOwner = {
  ...glProject,
  id: 100,
  path_with_namespace: "user1/my-project",
  owner: {
    username: "user1",
    avatar_url: "https://gitlab.com/uploads/-/user/avatar/user1.png",
  },
};

const glIssue = {
  id: 5001,
  iid: 15,
  title: "Login page broken",
  description: "Cannot log in after update",
  state: "opened",
  labels: ["bug", "critical"],
  author: { username: "tester" },
  created_at: "2024-03-01T09:00:00Z",
  updated_at: "2024-03-02T11:00:00Z",
};

const glMergeRequest = {
  id: 7001,
  iid: 33,
  title: "Refactor auth module",
  description: "Split auth into separate services",
  state: "opened",
  labels: ["refactor"],
  author: { username: "dev" },
  created_at: "2024-03-10T14:00:00Z",
  updated_at: "2024-03-11T16:00:00Z",
  source_branch: "refactor/auth",
  target_branch: "main",
  merged_at: null,
  draft: false,
};

const glMergedMR = {
  ...glMergeRequest,
  id: 7002,
  iid: 34,
  state: "merged",
  merged_at: "2024-03-12T10:00:00Z",
};

const glUser = {
  id: 1234,
  username: "johndoe",
  name: "John Doe",
  email: "john@example.com",
  avatar_url: "https://gitlab.com/uploads/-/system/user/avatar/1234/photo.jpg",
  is_admin: false,
};

const glDiscussion = {
  id: "6a9c1750b37d513a43987b574953fceb50b03ce7",
  individual_note: false,
  notes: [
    {
      id: 1126,
      body: "Please extract this helper",
      author: { username: "reviewer" },
      created_at: "2024-03-12T09:00:00Z",
      system: false,
      resolvable: true,
      resolved: false,
      position: {
        new_path: "src/auth.ts",
        old_path: "src/auth.ts",
        new_line: 42,
        old_line: 40,
        line_range: { start: { new_line: 40, old_line: 38 } },
      },
    },
    {
      id: 1129,
      body: "Will do",
      author: { username: "dev" },
      created_at: "2024-03-12T10:00:00Z",
      system: false,
      resolvable: true,
      resolved: false,
      position: null,
    },
  ],
};

const glIndividualNote = {
  id: "87805b7c09016a7058e91bdbe7b29d1f284a39e6",
  individual_note: true,
  notes: [
    {
      id: 1128,
      body: "a single comment",
      author: { username: "tester" },
      created_at: "2024-03-12T11:00:00Z",
      system: false,
      resolvable: false,
      resolved: false,
      position: null,
    },
  ],
};

const glNote = {
  id: 2201,
  type: null,
  body: "Hit the same thing on 16.9",
  author: { username: "commenter" },
  created_at: "2024-03-13T08:00:00Z",
  updated_at: "2024-03-13T08:15:00Z",
  system: false,
};

const glSystemNote = {
  id: 2202,
  type: null,
  body: "changed the description",
  author: { username: "maintainer" },
  created_at: "2024-03-13T09:00:00Z",
  updated_at: "2024-03-13T09:00:00Z",
  system: true,
};

const glDiffNote = {
  id: 2203,
  type: "DiffNote",
  body: "This helper belongs in utils",
  author: { username: "reviewer" },
  created_at: "2024-03-13T10:00:00Z",
  updated_at: "2024-03-13T10:00:00Z",
  system: false,
};

const glLegacyDiffNote = {
  id: 2204,
  type: "LegacyDiffNote",
  body: "old inline comment",
  author: { username: "reviewer" },
  created_at: "2024-03-13T11:00:00Z",
  updated_at: "2024-03-13T11:00:00Z",
  system: false,
};

// --- Helpers ---

function glHeaders(opts: { nextPage?: string; total?: string } = {}): Headers {
  const h = new Headers();
  if (opts.nextPage !== undefined) h.set("x-next-page", opts.nextPage);
  if (opts.total !== undefined) h.set("x-total", opts.total);
  return h;
}

function makeFetchError(status: number, message?: string): FetchError {
  const err = new FetchError(message || `HTTP ${status}`);
  err.status = status;
  err.statusCode = status;
  err.response = Object.assign(new Response(null, { status }), { _data: undefined });
  return err;
}

/** Mock the resolveProjectId client call */
function mockProjectResolve(projectId: number = 278964) {
  mocks.client.mockResolvedValueOnce({ id: projectId });
}

// --- Tests ---

describe("GitLabProvider", () => {
  let gl: GitLabProvider;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createHttpClient.mockReturnValue(mocks.client);
    gl = new GitLabProvider({
      baseURL: "https://gitlab.com/api/v4",
      token: "glpat-test",
    });
  });

  describe("constructor", () => {
    it("creates http client with Private-Token auth", () => {
      expect(mocks.createHttpClient).toHaveBeenCalledWith({
        baseURL: "https://gitlab.com/api/v4",
        token: "glpat-test",
        tokenHeader: "Private-Token",
        tokenPrefix: "",
      });
    });

    it("defaults baseURL when empty", () => {
      new GitLabProvider({ baseURL: "", token: "t" });
      expect(mocks.createHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: "https://gitlab.com/api/v4" }),
      );
    });

    it("appends /api/v4 for root instance URLs", () => {
      new GitLabProvider({ baseURL: "https://gitlab.example.com", token: "t" });

      expect(mocks.createHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: "https://gitlab.example.com/api/v4" }),
      );
    });

    it("appends /api/v4 for subpath instance URLs with trailing slash", () => {
      new GitLabProvider({ baseURL: "https://gitlab.example.com/gitlab/", token: "t" });

      expect(mocks.createHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: "https://gitlab.example.com/gitlab/api/v4" }),
      );
    });

    it("preserves already-prefixed api URLs", () => {
      new GitLabProvider({ baseURL: "https://gitlab.example.com/api/v4", token: "t" });

      expect(mocks.createHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: "https://gitlab.example.com/api/v4" }),
      );
    });

    it("preserves already-prefixed api URLs under a subpath", () => {
      new GitLabProvider({ baseURL: "https://gitlab.example.com/gitlab/api/v4", token: "t" });

      expect(mocks.createHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: "https://gitlab.example.com/gitlab/api/v4" }),
      );
    });

    it("does not treat near-miss paths as already prefixed", () => {
      new GitLabProvider({ baseURL: "https://gitlab.example.com/custom-api/v40", token: "t" });

      expect(mocks.createHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseURL: "https://gitlab.example.com/custom-api/v40/api/v4" }),
      );
    });

    it("does not treat api paths with extra trailing segments as already prefixed", () => {
      new GitLabProvider({ baseURL: "https://gitlab.example.com/custom/api/v4/proxy", token: "t" });

      expect(mocks.createHttpClient).toHaveBeenLastCalledWith(
        expect.objectContaining({
          baseURL: "https://gitlab.example.com/custom/api/v4/proxy/api/v4",
        }),
      );
    });
  });

  // --- Repos ---

  describe("repos.list", () => {
    it("returns mapped repositories", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glProject],
        headers: glHeaders({ total: "1" }),
      });

      const result = await gl.repos.list("gitlab-org");

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: "278964",
        name: "gitlab-foss",
        fullName: "gitlab-org/gitlab-foss",
        private: false,
        defaultBranch: "master",
        url: "https://gitlab.com/gitlab-org/gitlab-foss",
        cloneUrl: "https://gitlab.com/gitlab-org/gitlab-foss.git",
      });
    });

    it("falls back to group projects endpoint on user 404", async () => {
      mocks.rawFetch.mockRejectedValueOnce(makeFetchError(404)).mockResolvedValueOnce({
        data: [glProject],
        headers: glHeaders(),
      });

      const result = await gl.repos.list("gitlab-org");

      expect(mocks.rawFetch).toHaveBeenCalledTimes(2);
      expect(result.items).toHaveLength(1);
    });

    it("encodes nested group paths for both lookup endpoints", async () => {
      mocks.rawFetch.mockRejectedValueOnce(makeFetchError(404)).mockResolvedValueOnce({
        data: [glProject],
        headers: glHeaders(),
      });

      await gl.repos.list("parent/child");

      expect(mocks.rawFetch).toHaveBeenNthCalledWith(
        1,
        mocks.client,
        "/users/parent%2Fchild/projects",
        expect.any(Object),
      );
      expect(mocks.rawFetch).toHaveBeenNthCalledWith(
        2,
        mocks.client,
        "/groups/parent%2Fchild/projects",
        expect.any(Object),
      );
    });

    it("rejects unsafe namespace segments before transport", async () => {
      await expect(gl.repos.list("../admin")).rejects.toThrow("Invalid API path segment");
      expect(mocks.rawFetch).not.toHaveBeenCalled();
    });

    it("does not fall back to group endpoint on non-404 errors", async () => {
      mocks.rawFetch.mockRejectedValueOnce(makeFetchError(401));

      await expect(gl.repos.list("gitlab-org")).rejects.toThrow(AuthenticationError);
      expect(mocks.rawFetch).toHaveBeenCalledTimes(1);
    });

    it("maps totalCount from x-total header", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glProject],
        headers: glHeaders({ total: "42" }),
      });

      const result = await gl.repos.list("gitlab-org");
      expect(result.totalCount).toBe(42);
    });
  });

  describe("repos.get", () => {
    it("URL-encodes the project path", async () => {
      mocks.client.mockResolvedValueOnce(glProject);

      await gl.repos.get("gitlab-org", "gitlab-foss");

      expect(mocks.client).toHaveBeenCalledWith("/projects/gitlab-org%2Fgitlab-foss");
    });

    it("preserves nested groups while encoding each project path segment", async () => {
      mocks.client.mockResolvedValueOnce(glProject);

      await gl.repos.get("parent/child", "project name");

      expect(mocks.client).toHaveBeenCalledWith("/projects/parent%2Fchild%2Fproject%20name");
    });

    it("returns mapped repository", async () => {
      mocks.client.mockResolvedValueOnce(glProject);

      const repo = await gl.repos.get("gitlab-org", "gitlab-foss");

      expect(repo.fullName).toBe("gitlab-org/gitlab-foss");
      expect(repo.url).toBe("https://gitlab.com/gitlab-org/gitlab-foss");
    });

    it("uses owner when present, falls back to namespace", async () => {
      mocks.client.mockResolvedValueOnce(glProjectWithOwner);
      const withOwner = await gl.repos.get("user1", "my-project");
      expect(withOwner.owner.login).toBe("user1");

      mocks.client.mockResolvedValueOnce(glProject);
      const withNamespace = await gl.repos.get("gitlab-org", "gitlab-foss");
      expect(withNamespace.owner.login).toBe("gitlab-org");
    });
  });

  // --- Issues ---

  describe("issues.list", () => {
    it("resolves project ID then fetches issues", async () => {
      mockProjectResolve(278964);
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glIssue],
        headers: glHeaders(),
      });

      const result = await gl.issues.list("gitlab-org", "gitlab-foss");

      expect(mocks.client).toHaveBeenCalledWith("/projects/gitlab-org%2Fgitlab-foss");
      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        "/projects/278964/issues",
        expect.any(Object),
      );
      expect(result.items).toHaveLength(1);
    });

    it("converts open state filter to opened for GitLab API", async () => {
      mockProjectResolve();
      mocks.rawFetch.mockResolvedValueOnce({
        data: [],
        headers: glHeaders(),
      });

      await gl.issues.list("o", "r", { state: "open" });

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        expect.any(String),
        expect.objectContaining({
          query: expect.objectContaining({ state: "opened" }),
        }),
      );
    });
  });

  describe("issues.get", () => {
    it("uses iid for project-scoped lookup", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glIssue);

      const issue = await gl.issues.get("gitlab-org", "gitlab-foss", 15);

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/issues/15");
      expect(issue.number).toBe(15);
    });
  });

  describe("issues.create", () => {
    it("maps body → description and joins labels with comma", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glIssue);

      await gl.issues.create("gitlab-org", "gitlab-foss", {
        title: "New issue",
        body: "Description here",
        labels: ["bug", "urgent"],
      });

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/issues", {
        method: "POST",
        body: {
          title: "New issue",
          description: "Description here",
          labels: "bug,urgent",
        },
      });
    });
  });

  describe("issues.listComments", () => {
    it("fetches issue notes oldest first and drops system notes", async () => {
      mockProjectResolve(278964);
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glNote, glSystemNote],
        headers: glHeaders({ nextPage: "2", total: "5" }),
      });

      const result = await gl.issues.listComments("gitlab-org", "gitlab-foss", 7);

      expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/projects/278964/issues/7/notes", {
        query: {
          page: 1,
          per_page: 30,
          order_by: "created_at",
          sort: "asc",
        },
      });
      expect(result.items).toEqual([
        {
          id: "2201",
          body: "Hit the same thing on 16.9",
          author: { login: "commenter" },
          url: "",
          createdAt: "2024-03-13T08:00:00Z",
          updatedAt: "2024-03-13T08:15:00Z",
        },
      ]);
      expect(result.hasNextPage).toBe(true);
      expect(result.nextPage).toBe(2);
      expect(result.totalCount).toBeUndefined();
    });
  });

  // --- Merge Requests → Pull Requests ---

  describe("pullRequests.list", () => {
    it("fetches merge_requests endpoint and maps to pullRequests", async () => {
      mockProjectResolve(278964);
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glMergeRequest],
        headers: glHeaders(),
      });

      const result = await gl.pullRequests.list("gitlab-org", "gitlab-foss");

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        "/projects/278964/merge_requests",
        expect.any(Object),
      );
      expect(result.items[0]).toMatchObject({
        id: "7001",
        number: 33,
        title: "Refactor auth module",
        sourceBranch: "refactor/auth",
        targetBranch: "main",
        merged: false,
        draft: false,
      });
    });
  });

  describe("pullRequests.get", () => {
    it("returns mapped merge request as pull request", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce(glMergedMR);

      const pr = await gl.pullRequests.get("o", "r", 34);

      expect(pr.merged).toBe(true);
      expect(pr.state).toBe("closed");
    });
  });

  describe("pullRequests.create", () => {
    it("maps to GitLab merge_request API fields", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glMergeRequest);

      await gl.pullRequests.create("gitlab-org", "gitlab-foss", {
        title: "New MR",
        body: "Description",
        sourceBranch: "feature/x",
        targetBranch: "main",
      });

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/merge_requests", {
        method: "POST",
        body: expect.objectContaining({
          title: "New MR",
          description: "Description",
          source_branch: "feature/x",
          target_branch: "main",
        }),
      });
    });

    it("passes draft flag when set to true", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce({ ...glMergeRequest, draft: true });

      await gl.pullRequests.create("gitlab-org", "gitlab-foss", {
        title: "WIP: Draft MR",
        body: "Work in progress",
        sourceBranch: "draft/feature",
        targetBranch: "main",
        draft: true,
      });

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/merge_requests", {
        method: "POST",
        body: {
          title: "WIP: Draft MR",
          description: "Work in progress",
          source_branch: "draft/feature",
          target_branch: "main",
          draft: true,
        },
      });
    });

    it("omits draft field when not specified", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glMergeRequest);

      await gl.pullRequests.create("gitlab-org", "gitlab-foss", {
        title: "Regular MR",
        body: "No draft flag",
        sourceBranch: "feature/y",
        targetBranch: "main",
      });

      const calls = mocks.client.mock.calls;
      const callArgs = calls[calls.length - 1];
      const body = callArgs[1].body;
      expect(body).not.toHaveProperty("draft");
    });
  });

  describe("pullRequests.listComments", () => {
    it("fetches merge-request notes by iid and keeps diff notes out", async () => {
      mockProjectResolve(278964);
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glNote, glDiffNote, glLegacyDiffNote],
        headers: glHeaders(),
      });

      const result = await gl.pullRequests.listComments("gitlab-org", "gitlab-foss", 8, {
        page: 2,
        perPage: 10,
      });

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        "/projects/278964/merge_requests/8/notes",
        {
          query: {
            page: 2,
            per_page: 10,
            order_by: "created_at",
            sort: "asc",
          },
        },
      );
      expect(result.items.map((comment) => comment.id)).toEqual(["2201"]);
      expect(result.hasNextPage).toBe(false);
    });
  });

  // --- Users ---

  describe("users.get", () => {
    it("searches by username and returns first result", async () => {
      mocks.client.mockResolvedValueOnce([glUser]);

      const user = await gl.users.get("johndoe");

      expect(mocks.client).toHaveBeenCalledWith("/users", {
        query: { username: "johndoe" },
      });
      expect(user).toMatchObject({
        id: "1234",
        login: "johndoe",
        name: "John Doe",
        email: "john@example.com",
      });
    });

    it("throws when user search returns empty", async () => {
      mocks.client.mockResolvedValueOnce([]);

      await expect(gl.users.get("nonexistent")).rejects.toThrow(ForgesError);
    });

    it("throws NotFoundError with 404 status when user not found", async () => {
      mocks.client.mockResolvedValueOnce([]);

      const error = await gl.users.get("ghost").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).status).toBe(404);
      expect((error as NotFoundError).platform).toBe("gitlab");
    });
  });

  describe("users.authenticated", () => {
    it("fetches /user endpoint", async () => {
      mocks.client.mockResolvedValueOnce(glUser);

      const user = await gl.users.authenticated();

      expect(mocks.client).toHaveBeenCalledWith("/user");
      expect(user.login).toBe("johndoe");
    });
  });

  // --- Field Mapping Verification ---

  describe("field mapping (GitLab → unified)", () => {
    it("maps path_with_namespace → fullName", async () => {
      mocks.client.mockResolvedValueOnce({
        ...glProject,
        path_with_namespace: "org/repo",
      });
      const repo = await gl.repos.get("org", "repo");
      expect(repo.fullName).toBe("org/repo");
    });

    it("maps visibility → private boolean", async () => {
      mocks.client.mockResolvedValueOnce({
        ...glProject,
        visibility: "private",
      });
      const priv = await gl.repos.get("o", "r");
      expect(priv.private).toBe(true);

      mocks.client.mockResolvedValueOnce({
        ...glProject,
        visibility: "public",
      });
      const pub = await gl.repos.get("o", "r");
      expect(pub.private).toBe(false);
    });

    it("maps web_url → url", async () => {
      mocks.client.mockResolvedValueOnce(glProject);
      const repo = await gl.repos.get("o", "r");
      expect(repo.url).toBe("https://gitlab.com/gitlab-org/gitlab-foss");
    });

    it("maps http_url_to_repo → cloneUrl", async () => {
      mocks.client.mockResolvedValueOnce(glProject);
      const repo = await gl.repos.get("o", "r");
      expect(repo.cloneUrl).toBe("https://gitlab.com/gitlab-org/gitlab-foss.git");
    });

    it('maps null default_branch → "main"', async () => {
      mocks.client.mockResolvedValueOnce({
        ...glProject,
        default_branch: null,
      });
      const repo = await gl.repos.get("o", "r");
      expect(repo.defaultBranch).toBe("main");
    });

    it("maps iid → number", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({ ...glIssue, iid: 77 });
      const issue = await gl.issues.get("o", "r", 77);
      expect(issue.number).toBe(77);
    });

    it("maps description → body", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        ...glIssue,
        description: "Detailed description",
      });
      const issue = await gl.issues.get("o", "r", 1);
      expect(issue.body).toBe("Detailed description");
    });

    it("maps null description → empty string", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        ...glIssue,
        description: null,
      });
      const issue = await gl.issues.get("o", "r", 1);
      expect(issue.body).toBe("");
    });

    it("maps author.username → author.login", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        ...glIssue,
        author: { username: "gitlab-user" },
      });
      const issue = await gl.issues.get("o", "r", 1);
      expect(issue.author.login).toBe("gitlab-user");
    });

    it("maps source_branch → sourceBranch, target_branch → targetBranch", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        ...glMergeRequest,
        source_branch: "feat/x",
        target_branch: "develop",
      });
      const pr = await gl.pullRequests.get("o", "r", 1);
      expect(pr.sourceBranch).toBe("feat/x");
      expect(pr.targetBranch).toBe("develop");
    });

    it("maps merged_at → merged boolean", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        ...glMergeRequest,
        merged_at: null,
      });
      const notMerged = await gl.pullRequests.get("o", "r", 1);
      expect(notMerged.merged).toBe(false);

      // Project ID for 'o/r' is cached from first call — no extra resolve needed
      mocks.client.mockResolvedValueOnce({
        ...glMergeRequest,
        merged_at: "2024-01-01T00:00:00Z",
      });
      const merged = await gl.pullRequests.get("o", "r", 2);
      expect(merged.merged).toBe(true);
    });

    it("maps GitLab states to unified states", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({ ...glIssue, state: "opened" });
      const opened = await gl.issues.get("o", "r", 1);
      expect(opened.state).toBe("open");

      // Project ID for 'o/r' is cached from first call — no extra resolve needed
      mocks.client.mockResolvedValueOnce({ ...glIssue, state: "closed" });
      const closed = await gl.issues.get("o", "r", 2);
      expect(closed.state).toBe("closed");
    });

    it("maps merged MR state to closed", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({ ...glMergedMR, state: "merged" });
      const merged = await gl.pullRequests.get("o", "r", 1);
      expect(merged.state).toBe("closed");
    });

    it("maps username → login and is_admin → isAdmin for users", async () => {
      mocks.client.mockResolvedValueOnce({
        ...glUser,
        username: "gitlab-admin",
        is_admin: true,
      });
      const user = await gl.users.authenticated();
      expect(user.login).toBe("gitlab-admin");
      expect(user.isAdmin).toBe(true);
    });

    it("defaults null avatar_url to empty string", async () => {
      mocks.client.mockResolvedValueOnce({
        ...glUser,
        avatar_url: null,
      });
      const user = await gl.users.authenticated();
      expect(user.avatarUrl).toBe("");
    });

    it("converts numeric id to string", async () => {
      mocks.client.mockResolvedValueOnce(glProject);
      const repo = await gl.repos.get("o", "r");
      expect(repo.id).toBe("278964");
    });
  });

  // --- Pagination ---

  describe("pagination", () => {
    it("parses x-next-page header", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glProject],
        headers: glHeaders({ nextPage: "2", total: "50" }),
      });

      const result = await gl.repos.list("gitlab-org");

      expect(result.hasNextPage).toBe(true);
      expect(result.nextPage).toBe(2);
      expect(result.totalCount).toBe(50);
    });

    it("returns hasNextPage=false when x-next-page is empty string", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glProject],
        headers: glHeaders({ nextPage: "" }),
      });

      const result = await gl.repos.list("gitlab-org");

      expect(result.hasNextPage).toBe(false);
      expect(result.nextPage).toBeUndefined();
    });

    it("returns hasNextPage=false when no pagination headers", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [],
        headers: glHeaders(),
      });

      const result = await gl.repos.list("gitlab-org");

      expect(result.hasNextPage).toBe(false);
      expect(result.totalCount).toBeUndefined();
    });
  });

  // --- Error Handling ---

  describe("error handling", () => {
    it("throws NotFoundError on 404", async () => {
      mocks.client.mockRejectedValueOnce(makeFetchError(404));
      await expect(gl.repos.get("x", "nonexistent")).rejects.toThrow(NotFoundError);
    });

    it("throws AuthenticationError on 401", async () => {
      mocks.client.mockRejectedValueOnce(makeFetchError(401));
      await expect(gl.users.authenticated()).rejects.toThrow(AuthenticationError);
    });

    it("throws RateLimitError on 429", async () => {
      // Both user and group project endpoints must fail (listRepos has fallback)
      mocks.rawFetch
        .mockRejectedValueOnce(makeFetchError(429))
        .mockRejectedValueOnce(makeFetchError(429));
      await expect(gl.repos.list("x")).rejects.toThrow(RateLimitError);
    });

    it("sets platform to gitlab on errors", async () => {
      mocks.client.mockRejectedValueOnce(makeFetchError(500));

      const error = await gl.repos.get("x", "y").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForgesError);
      expect((error as ForgesError).platform).toBe("gitlab");
    });
  });

  // --- Project ID Caching ---

  describe("project ID resolution", () => {
    it("caches project ID across calls to avoid redundant lookups", async () => {
      // First call: resolveProjectId + getIssue
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glIssue);
      await gl.issues.get("gitlab-org", "gitlab-foss", 15);

      // Second call: uses cached project ID, only getIssue
      mocks.client.mockResolvedValueOnce(glIssue);
      await gl.issues.get("gitlab-org", "gitlab-foss", 16);

      // resolveProjectId called only once: 1 (resolve) + 1 (get#15) + 1 (get#16) = 3
      expect(mocks.client).toHaveBeenCalledTimes(3);
    });

    it("getRepo also populates project ID cache", async () => {
      // getRepo caches the project ID
      mocks.client.mockResolvedValueOnce(glProject);
      await gl.repos.get("gitlab-org", "gitlab-foss");

      // Subsequent issue.get should not need resolveProjectId
      mocks.client.mockResolvedValueOnce(glIssue);
      await gl.issues.get("gitlab-org", "gitlab-foss", 15);

      // getRepo(1) + getIssue(1) = 2 total (no extra resolve call)
      expect(mocks.client).toHaveBeenCalledTimes(2);
    });

    it("evicts least recently used project IDs when cache is full", async () => {
      const smallCacheProvider = new GitLabProvider({
        baseURL: "https://gitlab.com/api/v4",
        token: "glpat-test",
        gitlab: {
          projectIdCacheMax: 1,
        },
      });

      mockProjectResolve(101);
      mocks.client.mockResolvedValueOnce(glIssue);
      await smallCacheProvider.issues.get("group", "repo-one", 1);

      mockProjectResolve(202);
      mocks.client.mockResolvedValueOnce(glIssue);
      await smallCacheProvider.issues.get("group", "repo-two", 1);

      mockProjectResolve(101);
      mocks.client.mockResolvedValueOnce(glIssue);
      await smallCacheProvider.issues.get("group", "repo-one", 2);

      expect(mocks.client).toHaveBeenCalledTimes(6);
    });

    it("expires cached project IDs after TTL", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
        const shortTtlProvider = new GitLabProvider({
          baseURL: "https://gitlab.com/api/v4",
          token: "glpat-test",
          gitlab: {
            projectIdCacheTtl: 1000,
          },
        });

        mockProjectResolve(303);
        mocks.client.mockResolvedValueOnce(glIssue);
        await shortTtlProvider.issues.get("group", "repo-ttl", 1);

        vi.advanceTimersByTime(500);
        mocks.client.mockResolvedValueOnce(glIssue);
        await shortTtlProvider.issues.get("group", "repo-ttl", 2);

        vi.advanceTimersByTime(1001);
        mockProjectResolve(303);
        mocks.client.mockResolvedValueOnce(glIssue);
        await shortTtlProvider.issues.get("group", "repo-ttl", 3);

        expect(mocks.client).toHaveBeenCalledTimes(5);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps most recently used project IDs when cache is full", async () => {
      const smallCacheProvider = new GitLabProvider({
        baseURL: "https://gitlab.com/api/v4",
        token: "glpat-test",
        gitlab: {
          projectIdCacheMax: 2,
        },
      });

      mockProjectResolve(1);
      mocks.client.mockResolvedValueOnce(glIssue);
      await smallCacheProvider.issues.get("g", "repo-a", 1);

      mockProjectResolve(2);
      mocks.client.mockResolvedValueOnce(glIssue);
      await smallCacheProvider.issues.get("g", "repo-b", 1);

      mocks.client.mockResolvedValueOnce(glIssue);
      await smallCacheProvider.issues.get("g", "repo-a", 2);

      mockProjectResolve(3);
      mocks.client.mockResolvedValueOnce(glIssue);
      await smallCacheProvider.issues.get("g", "repo-c", 1);

      mockProjectResolve(2);
      mocks.client.mockResolvedValueOnce(glIssue);
      await smallCacheProvider.issues.get("g", "repo-b", 2);

      expect(mocks.client).toHaveBeenCalledTimes(9);
    });

    it("prunes expired entries before evicting valid ones", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
        const shortTtlProvider = new GitLabProvider({
          baseURL: "https://gitlab.com/api/v4",
          token: "glpat-test",
          gitlab: {
            projectIdCacheMax: 2,
            projectIdCacheTtl: 1000,
          },
        });

        mockProjectResolve(1);
        mocks.client.mockResolvedValueOnce(glIssue);
        await shortTtlProvider.issues.get("g", "repo-a", 1);

        vi.advanceTimersByTime(900);

        mockProjectResolve(2);
        mocks.client.mockResolvedValueOnce(glIssue);
        await shortTtlProvider.issues.get("g", "repo-b", 1);

        vi.advanceTimersByTime(200);

        mockProjectResolve(3);
        mocks.client.mockResolvedValueOnce(glIssue);
        await shortTtlProvider.issues.get("g", "repo-c", 1);

        mocks.client.mockResolvedValueOnce(glIssue);
        await shortTtlProvider.issues.get("g", "repo-b", 2);

        mockProjectResolve(1);
        mocks.client.mockResolvedValueOnce(glIssue);
        await shortTtlProvider.issues.get("g", "repo-a", 2);

        expect(mocks.client).toHaveBeenCalledTimes(9);
      } finally {
        vi.useRealTimers();
      }
    });

    it("falls back to default cache settings for invalid config values", async () => {
      const providerWithInvalidConfig = new GitLabProvider({
        baseURL: "https://gitlab.com/api/v4",
        token: "glpat-test",
        gitlab: {
          projectIdCacheMax: 0,
          projectIdCacheTtl: Number.NaN,
        },
      });

      mockProjectResolve(111);
      mocks.client.mockResolvedValueOnce(glIssue);
      await providerWithInvalidConfig.issues.get("g", "repo-one", 1);

      mockProjectResolve(222);
      mocks.client.mockResolvedValueOnce(glIssue);
      await providerWithInvalidConfig.issues.get("g", "repo-two", 1);

      mocks.client.mockResolvedValueOnce(glIssue);
      await providerWithInvalidConfig.issues.get("g", "repo-one", 2);

      expect(mocks.client).toHaveBeenCalledTimes(5);
    });
  });

  describe("threads", () => {
    it("lists only resolvable merge-request discussions", async () => {
      mockProjectResolve();
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glDiscussion, glIndividualNote],
        headers: glHeaders(),
      });

      const result = await gl.threads.list("gitlab-org", "gitlab-foss", 33);

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        "/projects/278964/merge_requests/33/discussions",
        { query: { page: 1, per_page: 50 } },
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: glDiscussion.id,
        isResolved: false,
        path: "src/auth.ts",
        line: 42,
        startLine: 40,
      });
      expect(result.items[0]?.comments).toHaveLength(2);
      expect(result.hasNextPage).toBe(false);
    });

    it("walks discussion pages until a filtered page is filled", async () => {
      mockProjectResolve();
      mocks.rawFetch
        .mockResolvedValueOnce({
          data: [glIndividualNote],
          headers: glHeaders({ nextPage: "2" }),
        })
        .mockResolvedValueOnce({
          data: [glDiscussion],
          headers: glHeaders(),
        });

      const result = await gl.threads.list("gitlab-org", "gitlab-foss", 33, {
        state: "unresolved",
        perPage: 1,
      });

      expect(mocks.rawFetch).toHaveBeenCalledTimes(2);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe(glDiscussion.id);
    });

    it("stops when a discussion page is empty even if a next page is advertised", async () => {
      mockProjectResolve();
      let calls = 0;
      mocks.rawFetch.mockImplementation(async () => {
        calls += 1;
        if (calls > 3) {
          throw new Error(`pagination looped ${calls} times`);
        }
        return {
          data: [],
          headers: glHeaders({ nextPage: "2" }),
        };
      });

      const result = await gl.threads.list("gitlab-org", "gitlab-foss", 33);

      expect(calls).toBe(1);
      expect(result.items).toEqual([]);
      expect(result.hasNextPage).toBe(false);
    });

    it("does not advertise a next page when no later discussion matches", async () => {
      mockProjectResolve();
      const resolvedDiscussion = {
        ...glDiscussion,
        id: "resolved-1",
        notes: glDiscussion.notes.map((note) => ({ ...note, resolved: true })),
      };
      mocks.rawFetch
        .mockResolvedValueOnce({
          data: [glDiscussion, resolvedDiscussion],
          headers: glHeaders({ nextPage: "2" }),
        })
        .mockResolvedValueOnce({
          data: [{ ...resolvedDiscussion, id: "resolved-2" }],
          headers: glHeaders(),
        });

      const result = await gl.threads.list("gitlab-org", "gitlab-foss", 33, {
        state: "unresolved",
        perPage: 1,
      });

      expect(mocks.rawFetch).toHaveBeenCalledTimes(2);
      expect(result.items.map((thread) => thread.id)).toEqual([glDiscussion.id]);
      expect(result.hasNextPage).toBe(false);
      expect(result.nextPage).toBeUndefined();
    });

    it("keeps a completed reply successful when cache eviction fails", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        id: 2001,
        body: "Done.",
        author: { username: "dev" },
        created_at: "2024-03-12T12:00:00Z",
        system: false,
      });
      mocks.invalidateCache.mockRejectedValueOnce(new Error("storage backend down"));

      const comment = await gl.threads.reply("gitlab-org", "gitlab-foss", 33, glDiscussion.id, {
        body: "Done.",
      });

      expect(comment.id).toBe("2001");
    });

    it("gets one discussion by id through the GET cache", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce(glDiscussion);

      const thread = await gl.threads.get("gitlab-org", "gitlab-foss", 33, glDiscussion.id);

      expect(mocks.cachedFetch).toHaveBeenCalledWith(
        mocks.client,
        `/projects/278964/merge_requests/33/discussions/${glDiscussion.id}`,
      );
      expect(thread.comments[0]?.body).toBe("Please extract this helper");
    });

    it("replies by posting a discussion note", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        id: 2001,
        body: "Done.",
        author: { username: "dev" },
        created_at: "2024-03-12T12:00:00Z",
        system: false,
      });

      const comment = await gl.threads.reply("gitlab-org", "gitlab-foss", 33, glDiscussion.id, {
        body: "Done.",
      });

      expect(mocks.client).toHaveBeenLastCalledWith(
        `/projects/278964/merge_requests/33/discussions/${glDiscussion.id}/notes`,
        { method: "POST", body: { body: "Done." } },
      );
      expect(mocks.invalidateCache).toHaveBeenCalledWith(
        mocks.client,
        `/projects/278964/merge_requests/33/discussions/${glDiscussion.id}`,
      );
      expect(comment.id).toBe("2001");
    });

    it("resolves and unresolves a discussion", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        ...glDiscussion,
        notes: glDiscussion.notes.map((note) => ({ ...note, resolved: true })),
      });
      mocks.client.mockResolvedValueOnce(glDiscussion);

      const resolved = await gl.threads.resolve("gitlab-org", "gitlab-foss", 33, glDiscussion.id);
      const unresolved = await gl.threads.unresolve(
        "gitlab-org",
        "gitlab-foss",
        33,
        glDiscussion.id,
      );

      expect(mocks.client).toHaveBeenCalledWith(
        `/projects/278964/merge_requests/33/discussions/${glDiscussion.id}`,
        { method: "PUT", body: { resolved: true } },
      );
      expect(mocks.client).toHaveBeenCalledWith(
        `/projects/278964/merge_requests/33/discussions/${glDiscussion.id}`,
        { method: "PUT", body: { resolved: false } },
      );
      expect(mocks.invalidateCache).toHaveBeenCalledTimes(2);
      expect(resolved.isResolved).toBe(true);
      expect(unresolved.isResolved).toBe(false);
    });
  });
});

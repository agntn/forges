import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  forked_from_project: null,
  permissions: {
    project_access: null,
    group_access: { access_level: 20 },
  },
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

const glCodeSearchItem = {
  basename: "provider.ts",
  data: "export abstract class Provider",
  path: "src/provider.ts",
  filename: "provider.ts",
  id: "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38",
  ref: "main",
  startline: 12,
  project_id: 278964,
};

const glPipeline = {
  id: 9001,
  project_id: 278964,
  ref: "main",
  sha: "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38",
  status: "failed",
  web_url: "https://gitlab.com/gitlab-org/gitlab-foss/-/pipelines/9001",
};

const glIssue = {
  id: 5001,
  iid: 15,
  title: "Login page broken",
  description: "Cannot log in after update",
  state: "opened",
  labels: ["bug", "critical"],
  author: { username: "tester" },
  assignees: [{ username: "triager" }],
  created_at: "2024-03-01T09:00:00Z",
  updated_at: "2024-03-02T11:00:00Z",
  web_url: "https://gitlab.com/gitlab-org/gitlab-foss/-/issues/15",
};

const glMergeRequest = {
  id: 7001,
  iid: 33,
  title: "Refactor auth module",
  description: "Split auth into separate services",
  state: "opened",
  labels: ["refactor"],
  author: { username: "dev" },
  assignees: [{ username: "maintainer" }],
  created_at: "2024-03-10T14:00:00Z",
  updated_at: "2024-03-11T16:00:00Z",
  web_url: "https://gitlab.com/gitlab-org/gitlab-foss/-/merge_requests/33",
  source_branch: "refactor/auth",
  target_branch: "main",
  merged_at: null,
  draft: false,
  merge_commit_sha: "not-a-landed-commit",
  sha: "9a6b45222d6f39adda15a820060d9d65adab2359",
  merge_status: "can_be_merged",
  detailed_merge_status: "ci_must_pass",
};

const glMergedMR = {
  ...glMergeRequest,
  id: 7002,
  iid: 34,
  state: "merged",
  merged_at: "2024-03-12T10:00:00Z",
  merge_commit_sha: "cd9bbd8a3e8af73864ca3c7704211309fae8ce0e",
  web_url: "https://gitlab.com/gitlab-org/gitlab-foss/-/merge_requests/34",
};

const glUser = {
  id: 1234,
  username: "johndoe",
  name: "John Doe",
  email: "john@example.com",
  avatar_url: "https://gitlab.com/uploads/-/system/user/avatar/1234/photo.jpg",
  is_admin: false,
  bio: "Backend developer",
  organization: "Acme",
  location: "Berlin",
  website_url: "https://johndoe.dev",
  followers: 5,
  following: 3,
  created_at: "2012-05-23T08:00:58Z",
  web_url: "https://gitlab.com/johndoe",
};

const glUserSearchHit = {
  id: glUser.id,
  username: glUser.username,
  name: glUser.name,
  avatar_url: glUser.avatar_url,
  web_url: glUser.web_url,
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("code.search", () => {
    it.each([
      [{}, "/search"],
      [{ owner: "gitlab-org" }, "/groups/gitlab-org/search"],
    ])("routes global and group searches through %s", async (scope, route) => {
      mocks.rawFetch.mockResolvedValueOnce({ data: [], headers: glHeaders() });

      await gl.code.search("Provider", scope);

      expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, route, {
        query: { scope: "blobs", search: "Provider", page: 1, per_page: 30 },
      });
    });

    it("searches a scoped project and enriches normalized result URLs", async () => {
      mocks.client.mockResolvedValueOnce(glProject);
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glCodeSearchItem],
        headers: glHeaders({ nextPage: "3", total: "12" }),
      });

      const result = await gl.code.search("Provider", {
        owner: "gitlab-org",
        repo: "gitlab-foss",
        page: 2,
        perPage: 1,
      });

      expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/projects/278964/search", {
        query: { scope: "blobs", search: "Provider", page: 2, per_page: 1 },
      });
      expect(mocks.client).toHaveBeenCalledTimes(1);
      expect(mocks.client).toHaveBeenCalledWith("/projects/gitlab-org%2Fgitlab-foss");
      expect(result).toEqual({
        items: [
          {
            repository: "gitlab-org/gitlab-foss",
            path: "src/provider.ts",
            url: "https://gitlab.com/gitlab-org/gitlab-foss/-/blob/main/src/provider.ts",
          },
        ],
        totalCount: 12,
        incomplete: false,
        hasNextPage: true,
        nextPage: 3,
      });
    });

    it("limits project enrichment to five concurrent requests", async () => {
      const projectIds = [1, 2, 3, 4, 5, 6];
      mocks.rawFetch.mockResolvedValueOnce({
        data: projectIds.map((projectId) => ({ ...glCodeSearchItem, project_id: projectId })),
        headers: glHeaders(),
      });
      const gates = projectIds.slice(0, 5).map(() => Promise.withResolvers<void>());
      let active = 0;
      let maximumActive = 0;
      mocks.client.mockImplementation(async (url: string) => {
        const projectId = Number(url.split("/").at(-1));
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const gate = gates[projectId - 1];
        if (gate) await gate.promise;
        active -= 1;
        return {
          ...glProject,
          id: projectId,
          path_with_namespace: `group/project-${projectId}`,
          web_url: `https://gitlab.com/group/project-${projectId}`,
        };
      });

      const search = gl.code.search("Provider", { perPage: 100 });
      await vi.waitFor(() => expect(mocks.client).toHaveBeenCalledTimes(5));
      expect(maximumActive).toBe(5);
      for (const gate of gates) gate.resolve();

      const result = await search;
      expect(result.items).toHaveLength(6);
      expect(maximumActive).toBe(5);
    });

    it("keeps a partial global page when one project cannot be enriched", async () => {
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glCodeSearchItem, { ...glCodeSearchItem, path: "src/other.ts", project_id: 99 }],
        headers: glHeaders({ total: "2" }),
      });
      mocks.client.mockResolvedValueOnce(glProject).mockRejectedValueOnce(new Error("gone"));

      const result = await gl.code.search("Provider");

      expect(result.items).toEqual([
        {
          repository: "gitlab-org/gitlab-foss",
          path: "src/provider.ts",
          url: "https://gitlab.com/gitlab-org/gitlab-foss/-/blob/main/src/provider.ts",
        },
      ]);
      expect(result).toMatchObject({ totalCount: 2, incomplete: true });
    });
  });

  describe("contributionTemplates", () => {
    const templateRows = [
      { key: "Bug", name: "Bug" },
      { key: "Bug", name: "Bug" },
      { key: "Security", name: "Security" },
    ];

    function mockTemplateDiscovery(): void {
      mocks.client.mockImplementation(async (url: string) => {
        if (url === "/projects/gitlab-org%2Fgitlab-foss") return glProject;
        if (url === "/projects/278964/templates/issues/Security") {
          return { key: "Security", name: "Security", content: "Report privately.\n" };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });
      mocks.rawFetch.mockImplementation(async (_client: unknown, url: string) => {
        if (url === "/projects/278964/templates/issues") {
          return { data: templateRows, headers: new Headers() };
        }
        if (url === "/projects/278964/repository/tree") {
          return {
            data: [
              {
                id: "abc123",
                name: "Bug.md",
                type: "blob",
                path: ".gitlab/issue_templates/Bug.md",
              },
            ],
            headers: new Headers(),
          };
        }
        throw new Error(`Unexpected raw URL: ${url}`);
      });
    }

    it("deduplicates effective names and distinguishes project-local from inherited templates", async () => {
      mockTemplateDiscovery();

      const page = await gl.contributionTemplates.list("gitlab-org", "gitlab-foss", "issue", {
        perPage: 1,
      });

      expect(page).toEqual({
        items: [
          {
            kind: "issue",
            key: "Bug",
            name: "Bug",
            scope: "repository",
            inherited: false,
            sourceRepository: "gitlab-org/gitlab-foss",
            sourcePath: ".gitlab/issue_templates/Bug.md",
            sourceRef: "master",
          },
        ],
        totalCount: 2,
        hasNextPage: true,
        nextPage: 2,
      });
    });

    it("retrieves inherited content without inventing unavailable source provenance", async () => {
      mockTemplateDiscovery();

      const template = await gl.contributionTemplates.get(
        "gitlab-org",
        "gitlab-foss",
        "issue",
        "Security",
      );

      expect(template).toEqual({
        kind: "issue",
        key: "Security",
        name: "Security",
        scope: "unknown",
        inherited: true,
        sourceRepository: null,
        sourcePath: null,
        sourceRef: null,
        content: "Report privately.\n",
      });
    });

    it("rejects non-advancing effective-template pagination", async () => {
      mocks.client.mockResolvedValueOnce(glProject);
      mocks.rawFetch.mockImplementation(async (_client: unknown, url: string) => {
        if (url === "/projects/278964/templates/issues") {
          return {
            data: [{ key: "Bug", name: "Bug" }],
            headers: new Headers({ "x-next-page": "1" }),
          };
        }
        if (url === "/projects/278964/repository/tree") {
          return { data: [], headers: new Headers() };
        }
        throw new Error(`Unexpected raw URL: ${url}`);
      });

      await expect(
        gl.contributionTemplates.list("gitlab-org", "gitlab-foss", "issue"),
      ).rejects.toMatchObject({ status: 502 });
    });

    it("keeps provenance unknown when the local template tree is unavailable", async () => {
      mocks.client.mockResolvedValueOnce(glProject);
      mocks.rawFetch.mockImplementation(async (_client: unknown, url: string) => {
        if (url === "/projects/278964/templates/issues") {
          return {
            data: [{ key: "Security", name: "Security" }],
            headers: new Headers(),
          };
        }
        if (url === "/projects/278964/repository/tree") throw makeFetchError(404);
        throw new Error(`Unexpected raw URL: ${url}`);
      });

      const page = await gl.contributionTemplates.list("gitlab-org", "gitlab-foss", "issue");

      expect(page.items[0]).toMatchObject({ scope: "unknown", inherited: true });
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
      mocks.client.mockResolvedValueOnce({
        ...glProject,
        namespace: {
          ...glProject.namespace,
          avatar_url: "/uploads/-/system/group/avatar/9970/logo.png",
        },
      });

      const repo = await gl.repos.get("gitlab-org", "gitlab-foss");

      expect(repo.fullName).toBe("gitlab-org/gitlab-foss");
      expect(repo.url).toBe("https://gitlab.com/gitlab-org/gitlab-foss");
      expect(repo.isFork).toBe(false);
      expect(repo.parent).toBeNull();
      expect(repo.viewerPermission).toBe("triage");
      expect(repo.owner.avatarUrl).toBe(
        "https://gitlab.com/uploads/-/system/group/avatar/9970/logo.png",
      );
    });

    it("maps a fork parent and the highest inherited access level", async () => {
      mocks.client.mockResolvedValueOnce({
        ...glProject,
        forked_from_project: {
          path_with_namespace: "upstream/gitlab-foss",
          web_url: "https://gitlab.com/upstream/gitlab-foss",
        },
        permissions: {
          project_access: { access_level: 30 },
          group_access: { access_level: 40 },
        },
      });

      const repo = await gl.repos.get("gitlab-org", "gitlab-foss");

      expect(repo).toMatchObject({
        isFork: true,
        parent: {
          fullName: "upstream/gitlab-foss",
          url: "https://gitlab.com/upstream/gitlab-foss",
        },
        viewerPermission: "maintain",
      });
    });

    it("keeps fork state when the upstream project is hidden", async () => {
      mocks.client.mockResolvedValueOnce({
        ...glProject,
        forked_from_project: undefined,
        mr_default_target_self: false,
      });

      const repo = await gl.repos.get("gitlab-org", "gitlab-foss");

      expect(repo.isFork).toBe(true);
      expect(repo.parent).toBeNull();
    });

    it("distinguishes no membership from unavailable permission metadata", async () => {
      mocks.client
        .mockResolvedValueOnce({
          ...glProject,
          permissions: { project_access: null, group_access: null },
        })
        .mockResolvedValueOnce({ ...glProject, permissions: undefined });

      const noMembership = await gl.repos.get("gitlab-org", "gitlab-foss");
      const unavailable = await gl.repos.get("gitlab-org", "gitlab-foss");

      expect(noMembership.viewerPermission).toBe("none");
      expect(unavailable.viewerPermission).toBeNull();
    });

    it("maps Guest to read and the roles below Developer to triage", async () => {
      const ladder = [
        [5, "none"],
        [10, "read"],
        [15, "triage"],
        [20, "triage"],
        [25, "triage"],
        [30, "write"],
      ] as const;

      for (const [accessLevel, expected] of ladder) {
        mocks.client.mockResolvedValueOnce({
          ...glProject,
          permissions: { project_access: { access_level: accessLevel }, group_access: null },
        });

        const repo = await gl.repos.get("gitlab-org", "gitlab-foss");

        expect(repo.viewerPermission).toBe(expected);
      }
    });

    it("reads current viewer permission on every call", async () => {
      mocks.cachedFetch.mockResolvedValue(glProject);
      mocks.client.mockResolvedValueOnce(glProject).mockResolvedValueOnce({
        ...glProject,
        permissions: {
          project_access: { access_level: 30 },
          group_access: null,
        },
      });

      await gl.repos.get("gitlab-org", "gitlab-foss");
      const repository = await gl.repos.get("gitlab-org", "gitlab-foss");

      expect(repository.viewerPermission).toBe("write");
      expect(mocks.client).toHaveBeenCalledTimes(2);
      expect(mocks.cachedFetch).not.toHaveBeenCalled();
    });

    it("uses owner when present, falls back to namespace", async () => {
      mocks.client.mockResolvedValueOnce(glProjectWithOwner);
      const withOwner = await gl.repos.get("user1", "my-project");
      expect(withOwner.owner.login).toBe("user1");
      expect(withOwner.owner.avatarUrl).toBe("https://gitlab.com/uploads/-/user/avatar/user1.png");

      mocks.client.mockResolvedValueOnce(glProject);
      const withNamespace = await gl.repos.get("gitlab-org", "gitlab-foss");
      expect(withNamespace.owner.login).toBe("gitlab-org");
    });

    it("resolves group avatar paths against a self-hosted origin", async () => {
      gl = new GitLabProvider({ baseURL: "https://gitlab.example.com/root", token: "test-token" });
      mocks.client.mockResolvedValueOnce({
        ...glProject,
        namespace: {
          ...glProject.namespace,
          avatar_url: "/uploads/-/system/group/avatar/9970/logo.png",
        },
      });

      const repo = await gl.repos.get("gitlab-org", "gitlab-foss");

      expect(repo.owner.avatarUrl).toBe(
        "https://gitlab.example.com/uploads/-/system/group/avatar/9970/logo.png",
      );
    });
  });

  // --- CI runs ---

  describe("repos.readContents", () => {
    const sha = "f5016eda261bb7142627d05d1d85a20d6dd56ddc";
    const glFile = (content: string | Uint8Array) => ({
      size: Buffer.from(content).length,
      encoding: "base64",
      content: Buffer.from(content).toString("base64"),
      commit_id: sha,
    });

    it("reads a file at HEAD and reports the commit the files API resolved", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce(glFile("# GLab\n"));

      const file = await gl.repos.readContents("gitlab-org", "cli", "docs/README.md");

      expect(mocks.client).toHaveBeenLastCalledWith(
        "/projects/278964/repository/files/docs%2FREADME.md",
        { query: { ref: "HEAD" } },
      );
      expect(file).toMatchObject({
        type: "file",
        path: "docs/README.md",
        sha,
        content: "# GLab\n",
      });
    });

    it("pins a tag read and refuses to continue from the tag", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce(glFile("abcdef"));

      const first = await gl.repos.readContents("gitlab-org", "cli", "a", {
        ref: "v1.0",
        maxChars: 4,
      });
      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/repository/files/a", {
        query: { ref: "v1.0" },
      });
      expect(first).toMatchObject({ content: "abcd", nextOffset: 4 });

      mocks.client.mockResolvedValueOnce(glFile("abcdef"));
      await expect(
        gl.repos.readContents("gitlab-org", "cli", "a", { ref: "v1.0", offset: 4 }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("refuses a file above the size limit", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({ ...glFile("x"), size: 2_000_000 });

      await expect(gl.repos.readContents("gitlab-org", "cli", "big.bin")).rejects.toMatchObject({
        status: 413,
      });
    });

    it("falls back to the tree for a directory and maps entry kinds", async () => {
      mockProjectResolve();
      mocks.client.mockRejectedValueOnce(makeFetchError(404)).mockResolvedValueOnce({ id: sha });
      mocks.rawFetch
        .mockResolvedValueOnce({
          data: [
            { name: ".vale", path: "docs/.vale", type: "tree", mode: "040000" },
            { name: "link", path: "docs/link", type: "blob", mode: "120000" },
          ],
          headers: glHeaders({ nextPage: "2" }),
        })
        .mockResolvedValueOnce({
          data: [{ name: "index.md", path: "docs/index.md", type: "blob", mode: "100644" }],
          headers: glHeaders({ nextPage: "" }),
        });

      const listing = await gl.repos.readContents("gitlab-org", "cli", "docs");

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/repository/commits/HEAD");
      expect(mocks.rawFetch).toHaveBeenNthCalledWith(
        1,
        mocks.client,
        "/projects/278964/repository/tree",
        {
          query: { ref: sha, path: "docs", page: 1, per_page: 100 },
        },
      );
      expect(listing).toEqual({
        type: "directory",
        path: "docs",
        sha,
        entries: [
          { name: ".vale", path: "docs/.vale", type: "directory", size: null },
          { name: "link", path: "docs/link", type: "symlink", size: null },
          { name: "index.md", path: "docs/index.md", type: "file", size: null },
        ],
        entriesComplete: true,
      });
    });

    it("stops a huge tree at the page cap and says the listing is partial", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({ id: sha });
      for (let page = 1; page <= 10; page += 1) {
        mocks.rawFetch.mockResolvedValueOnce({
          data: [{ name: `f${page}`, path: `f${page}`, type: "blob", mode: "100644" }],
          headers: glHeaders({ nextPage: String(page + 1) }),
        });
      }

      const root = await gl.repos.readContents("gitlab-org", "cli", "");

      expect(mocks.rawFetch).toHaveBeenCalledTimes(10);
      expect(root).toMatchObject({ type: "directory", path: "", entriesComplete: false });
      expect(mocks.rawFetch.mock.calls[0]?.[2]).toEqual({
        query: { ref: sha, path: undefined, page: 1, per_page: 100 },
      });
    });

    it("reports a path that is neither file nor tree as not found", async () => {
      mockProjectResolve();
      mocks.client.mockRejectedValueOnce(makeFetchError(404)).mockResolvedValueOnce({ id: sha });
      mocks.rawFetch.mockResolvedValueOnce({ data: [], headers: glHeaders() });

      await expect(gl.repos.readContents("gitlab-org", "cli", "nope")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe("ciRuns jobs", () => {
    const glJob = {
      id: 16667043902,
      name: "lint",
      stage: "test",
      status: "failed",
      started_at: "2026-09-22T22:19:29.611Z",
      finished_at: "2026-09-22T22:20:07.077Z",
      web_url: "https://gitlab.com/gitlab-org/gitlab-foss/-/jobs/16667043902",
      pipeline: { id: 9001 },
    };

    it("lists the jobs of one pipeline without steps", async () => {
      mockProjectResolve();
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glJob, { ...glJob, id: 16667043903, status: "created", started_at: null }],
        headers: glHeaders({ total: "2" }),
      });

      const result = await gl.ciRuns.listJobs("gitlab-org", "gitlab-foss", "9001", { perPage: 10 });

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        "/projects/278964/pipelines/9001/jobs",
        { query: { page: 1, per_page: 10 } },
      );
      expect(result.items).toEqual([
        {
          id: "16667043902",
          runId: "9001",
          name: "lint",
          status: "completed",
          conclusion: "failure",
          startedAt: "2026-09-22T22:19:29.611Z",
          completedAt: "2026-09-22T22:20:07.077Z",
          url: "https://gitlab.com/gitlab-org/gitlab-foss/-/jobs/16667043902",
          steps: [],
        },
        expect.objectContaining({ id: "16667043903", status: "queued", startedAt: null }),
      ]);
    });

    it("reads a job trace without timestamps, section markers or ANSI", async () => {
      mockProjectResolve();
      const trace = [
        "2026-09-22T22:19:30.000000Z 00O section_start:1790115570:step_script\r\u001b[0K$ npm test",
        "2026-09-22T22:20:06.821736Z 00O \u001b[31;1mERROR: Job failed: exit code 1\u001b[0;m",
        "",
      ].join("\n");
      mocks.client.mockResolvedValueOnce(glJob).mockResolvedValueOnce(new Response(trace).body);

      const log = await gl.ciRuns.readJobLog("gitlab-org", "gitlab-foss", "16667043902");

      expect(mocks.client).toHaveBeenNthCalledWith(2, "/projects/278964/jobs/16667043902");
      expect(mocks.client).toHaveBeenNthCalledWith(3, "/projects/278964/jobs/16667043902/trace", {
        responseType: "stream",
      });
      expect(log).toMatchObject({
        jobId: "16667043902",
        conclusion: "failure",
        started: true,
        content: "$ npm test\nERROR: Job failed: exit code 1\n",
      });
    });

    it("says a job that never started has no trace", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({ ...glJob, status: "skipped", started_at: null });

      const log = await gl.ciRuns.readJobLog("gitlab-org", "gitlab-foss", "16667043902");

      expect(mocks.client).toHaveBeenCalledTimes(2);
      expect(log).toMatchObject({ started: false, conclusion: "skipped", content: "" });
    });
  });

  describe("ciRuns.list", () => {
    it("returns normalized paged pipelines and filters by ref", async () => {
      mockProjectResolve();
      mocks.rawFetch.mockResolvedValueOnce({
        data: [
          glPipeline,
          { ...glPipeline, id: 9002, status: "running" },
          { ...glPipeline, id: 9003, status: "manual" },
        ],
        headers: glHeaders({ nextPage: "3", total: "12" }),
      });

      const result = await gl.ciRuns.list("gitlab-org", "gitlab-foss", {
        branch: "main",
        page: 2,
        perPage: 10,
      });

      expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/projects/278964/pipelines", {
        query: { page: 2, per_page: 10, ref: "main" },
      });
      expect(result).toEqual({
        items: [
          {
            id: "9001",
            branch: "main",
            revision: "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38",
            status: "completed",
            conclusion: "failure",
            url: "https://gitlab.com/gitlab-org/gitlab-foss/-/pipelines/9001",
          },
          expect.objectContaining({ id: "9002", status: "in_progress", conclusion: null }),
          expect.objectContaining({ id: "9003", status: "waiting", conclusion: null }),
        ],
        totalCount: 12,
        hasNextPage: true,
        nextPage: 3,
      });
    });
  });

  describe("commits.list", () => {
    it("returns paged commit summaries and maps portable filters", async () => {
      const sha = "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38";
      const commit = {
        id: sha,
        message: "feat: list commit history",
        author_name: "Ori",
        author_email: "ori@example.com",
        authored_date: "2026-08-29T10:00:00Z",
        committer_name: "Ori",
        committer_email: "ori@example.com",
        committed_date: "2026-08-29T10:01:00Z",
        parent_ids: ["parent-sha"],
        web_url: `https://gitlab.com/gitlab-org/gitlab-foss/-/commit/${sha}`,
      };
      mockProjectResolve();
      mocks.rawFetch.mockResolvedValueOnce({
        data: [commit],
        headers: glHeaders({ nextPage: "3" }),
      });

      const result = await gl.commits.list("gitlab-org", "gitlab-foss", {
        ref: "main",
        path: "src/provider.ts",
        since: "2026-08-01T00:00:00Z",
        until: "2026-08-29T23:59:59Z",
        page: 2,
        perPage: 10,
      });

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        "/projects/278964/repository/commits",
        {
          query: {
            ref_name: "main",
            path: "src/provider.ts",
            since: "2026-08-01T00:00:00Z",
            until: "2026-08-29T23:59:59Z",
            page: 2,
            per_page: 10,
          },
        },
      );
      expect(result).toEqual({
        items: [
          {
            sha,
            message: "feat: list commit history",
            author: { name: "Ori", email: "ori@example.com", date: "2026-08-29T10:00:00Z" },
            committer: {
              name: "Ori",
              email: "ori@example.com",
              date: "2026-08-29T10:01:00Z",
            },
            parents: ["parent-sha"],
            url: commit.web_url,
          },
        ],
        totalCount: undefined,
        hasNextPage: true,
        nextPage: 3,
      });
    });
  });

  describe("commits.get", () => {
    it("returns commit metadata and drains diff pages without returning diffs", async () => {
      const sha = "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38";
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        id: sha,
        message: "fix: preserve commit metadata",
        author_name: "Ori",
        author_email: "ori@example.com",
        authored_date: "2026-08-29T10:00:00Z",
        committer_name: "Ori",
        committer_email: "ori@example.com",
        committed_date: "2026-08-29T10:01:00Z",
        parent_ids: ["parent-sha"],
        web_url: `https://gitlab.com/gitlab-org/gitlab-foss/-/commit/${sha}`,
      });
      mocks.rawFetch
        .mockResolvedValueOnce({
          data: [
            {
              old_path: "src/provider.ts",
              new_path: "src/provider.ts",
              new_file: false,
              renamed_file: false,
              deleted_file: false,
              collapsed: false,
              too_large: false,
              diff: "--- a/src/provider.ts\n+++ b/src/provider.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line",
            },
          ],
          headers: glHeaders({ nextPage: "2" }),
        })
        .mockResolvedValueOnce({
          data: [
            {
              old_path: "generated.js",
              new_path: "generated.js",
              new_file: false,
              renamed_file: false,
              deleted_file: false,
              collapsed: false,
              too_large: true,
              diff: "",
            },
          ],
          headers: glHeaders(),
        });

      const result = await gl.commits.get("gitlab-org", "gitlab-foss", sha);

      expect(mocks.client).toHaveBeenNthCalledWith(2, `/projects/278964/repository/commits/${sha}`);
      expect(mocks.rawFetch).toHaveBeenNthCalledWith(
        1,
        mocks.client,
        `/projects/278964/repository/commits/${sha}/diff`,
        { query: { page: 1, per_page: 100 } },
      );
      expect(mocks.rawFetch).toHaveBeenNthCalledWith(
        2,
        mocks.client,
        `/projects/278964/repository/commits/${sha}/diff`,
        { query: { page: 2, per_page: 100 } },
      );
      expect(result).toEqual({
        sha,
        message: "fix: preserve commit metadata",
        author: { name: "Ori", email: "ori@example.com", date: "2026-08-29T10:00:00Z" },
        committer: { name: "Ori", email: "ori@example.com", date: "2026-08-29T10:01:00Z" },
        parents: ["parent-sha"],
        url: `https://gitlab.com/gitlab-org/gitlab-foss/-/commit/${sha}`,
        files: [
          { path: "src/provider.ts", status: "modified", additions: 2, deletions: 1 },
          { path: "generated.js", status: "modified", additions: null, deletions: null },
        ],
        filesComplete: null,
      });
      expect(JSON.stringify(result)).not.toContain("diff");
    });

    it.each(["invalid", "101"])("stops on unsafe next-page header %s", async (nextPage) => {
      const sha = "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38";
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        id: sha,
        message: "one page",
        author_name: "Ori",
        author_email: "ori@example.com",
        authored_date: "2026-08-29T10:00:00Z",
        committer_name: "Ori",
        committer_email: "ori@example.com",
        committed_date: "2026-08-29T10:00:00Z",
        parent_ids: [],
        web_url: `https://gitlab.com/gitlab-org/gitlab-foss/-/commit/${sha}`,
      });
      mocks.rawFetch.mockResolvedValueOnce({
        data: [],
        headers: glHeaders({ nextPage }),
      });

      await gl.commits.get("gitlab-org", "gitlab-foss", sha);

      expect(mocks.rawFetch).toHaveBeenCalledTimes(1);
    });

    it("keeps GitLab patch states and completeness conservative", async () => {
      const ref = "feature/my-change";
      const sha = "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38";
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        id: sha,
        message: "patch",
        author_name: "Ori",
        author_email: "ori@example.com",
        authored_date: "2026-08-29T10:00:00Z",
        committer_name: "Ori",
        committer_email: "ori@example.com",
        committed_date: "2026-08-29T10:00:00Z",
        parent_ids: [],
        web_url: `https://gitlab.com/gitlab-org/gitlab-foss/-/commit/${sha}`,
      });
      mocks.rawFetch.mockResolvedValueOnce({
        data: [
          {
            old_path: "old.ts",
            new_path: "new.ts",
            new_file: false,
            renamed_file: true,
            deleted_file: false,
            diff: "",
          },
          {
            old_path: "logo.png",
            new_path: "logo.png",
            new_file: false,
            renamed_file: false,
            deleted_file: false,
            diff: "Binary files a/logo.png and b/logo.png differ",
          },
          {
            old_path: "generated.js",
            new_path: "generated.js",
            new_file: false,
            renamed_file: false,
            deleted_file: false,
            too_large: true,
            diff: "",
          },
        ],
        headers: glHeaders(),
      });

      const result = await gl.commits.readPatch("gitlab-org", "gitlab-foss", ref);

      expect(mocks.client).toHaveBeenLastCalledWith(
        "/projects/278964/repository/commits/feature%2Fmy-change",
      );
      expect(result.filesComplete).toBeNull();
      expect(result.states).toEqual({ included: 1, binary: 1, unavailable: 1 });
      expect(result.content).toContain("--- renamed new.ts from old.ts");
      expect(result.content).toContain("[binary patch omitted]");
      expect(result.content).toContain("[patch unavailable from provider]");
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
      expect(result.items[0]?.assignees).toEqual([{ login: "triager" }]);
      expect(result.items[0]?.url).toBe("https://gitlab.com/gitlab-org/gitlab-foss/-/issues/15");
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

  describe("issues.search", () => {
    it("searches project issues with text, state, and pagination", async () => {
      mockProjectResolve(278964);
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glIssue],
        headers: glHeaders({ nextPage: "3", total: "7" }),
      });

      const result = await gl.issues.search("gitlab-org", "gitlab-foss", "runner timeout", {
        state: "open",
        page: 2,
        perPage: 1,
      });

      expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/projects/278964/issues", {
        query: {
          search: "runner timeout",
          state: "opened",
          page: 2,
          per_page: 1,
        },
      });
      expect(result).toMatchObject({
        items: [expect.objectContaining({ number: 15 })],
        incomplete: false,
        totalCount: 7,
        hasNextPage: true,
        nextPage: 3,
      });
    });
  });

  describe("issues.get", () => {
    it("uses iid for project-scoped lookup", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glIssue);

      const issue = await gl.issues.get("gitlab-org", "gitlab-foss", 15);

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/issues/15");
      expect(issue.number).toBe(15);
      expect(issue.assignees).toEqual([{ login: "triager" }]);
      expect(issue.url).toBe("https://gitlab.com/gitlab-org/gitlab-foss/-/issues/15");
    });

    it("reads current state on every call", async () => {
      const closed = { ...glIssue, state: "closed", updated_at: "2024-03-03T11:00:00Z" };
      mockProjectResolve(278964);
      mocks.cachedFetch.mockResolvedValue(glIssue);
      mocks.client.mockResolvedValueOnce(glIssue).mockResolvedValueOnce(closed);

      await gl.issues.get("gitlab-org", "gitlab-foss", 15);
      const issue = await gl.issues.get("gitlab-org", "gitlab-foss", 15);

      expect(issue.state).toBe("closed");
      expect(issue.updatedAt).toBe("2024-03-03T11:00:00Z");
      expect(mocks.client).toHaveBeenCalledTimes(3);
      expect(mocks.cachedFetch).not.toHaveBeenCalled();
    });
  });

  describe("issues.create", () => {
    it("maps body, labels, and a single assignee", async () => {
      mockProjectResolve(278964);
      mocks.client
        .mockResolvedValueOnce([{ ...glUserSearchHit, id: 9, username: "triager" }])
        .mockResolvedValueOnce(glIssue);

      const issue = await gl.issues.create("gitlab-org", "gitlab-foss", {
        title: "New issue",
        body: "Description here",
        labels: ["bug", "urgent"],
        assignees: ["triager"],
      });

      expect(mocks.client).toHaveBeenNthCalledWith(2, "/users", {
        query: { username: "triager" },
      });
      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/issues", {
        method: "POST",
        body: {
          title: "New issue",
          description: "Description here",
          labels: "bug,urgent",
          assignee_id: 9,
        },
      });
      expect(issue.assignees).toEqual([{ login: "triager" }]);
      expect(issue.url).toBe("https://gitlab.com/gitlab-org/gitlab-foss/-/issues/15");
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

  describe("issues.getComment", () => {
    it("reads one note scoped to its issue", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glNote);

      const comment = await gl.issues.getComment("gitlab-org", "gitlab-foss", 7, "2201");

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/issues/7/notes/2201");
      expect(comment).toMatchObject({ id: "2201", body: "Hit the same thing on 16.9" });
    });

    it("reads the current comment body on every call", async () => {
      const edited = { ...glNote, body: "Edited after the first read" };
      mockProjectResolve(278964);
      mocks.cachedFetch.mockResolvedValue(glNote);
      mocks.client.mockResolvedValueOnce(glNote).mockResolvedValueOnce(edited);

      await gl.issues.getComment("gitlab-org", "gitlab-foss", 7, "2201");
      const comment = await gl.issues.getComment("gitlab-org", "gitlab-foss", 7, "2201");

      expect(comment.body).toBe("Edited after the first read");
      expect(mocks.client).toHaveBeenCalledTimes(3);
      expect(mocks.cachedFetch).not.toHaveBeenCalled();
    });

    it("answers 404 for a note the list would drop", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glSystemNote);

      await expect(gl.issues.getComment("gitlab-org", "gitlab-foss", 7, "2301")).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("createComment", () => {
    it("posts a note on the issue", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glNote);

      const comment = await gl.issues.createComment("gitlab-org", "gitlab-foss", 7, {
        body: "Hit the same thing on 16.9",
      });

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/issues/7/notes", {
        method: "POST",
        body: { body: "Hit the same thing on 16.9" },
      });
      expect(comment).toMatchObject({ id: "2201", body: "Hit the same thing on 16.9" });
    });

    it("posts on the merge request, not on the issue with the same number", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glNote);

      await gl.pullRequests.createComment("gitlab-org", "gitlab-foss", 7, { body: "Rebased" });

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/merge_requests/7/notes", {
        method: "POST",
        body: { body: "Rebased" },
      });
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
        assignees: [{ login: "maintainer" }],
        sourceBranch: "refactor/auth",
        targetBranch: "main",
        merged: false,
        draft: false,
        mergeCommitSha: "",
        headSha: "9a6b45222d6f39adda15a820060d9d65adab2359",
        mergeable: true,
        mergeStatus: "ci_must_pass",
        url: "https://gitlab.com/gitlab-org/gitlab-foss/-/merge_requests/33",
      });
    });
  });

  describe("pullRequests.listFiles", () => {
    it("reads changed files and derives counts from available diffs", async () => {
      mockProjectResolve(278964);
      mocks.rawFetch.mockResolvedValueOnce({
        data: [
          {
            old_path: "src/auth.ts",
            new_path: "src/auth.ts",
            new_file: false,
            renamed_file: false,
            deleted_file: false,
            collapsed: false,
            too_large: false,
            diff: "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1,3 +1,4 @@\n unchanged\n-removed\n---counter\n+added\n+added again\n+++counter",
          },
          {
            old_path: "generated.js",
            new_path: "generated.js",
            new_file: false,
            renamed_file: false,
            deleted_file: false,
            collapsed: false,
            too_large: true,
            diff: "",
          },
        ],
        headers: glHeaders({ nextPage: "3", total: "4" }),
      });

      const result = await gl.pullRequests.listFiles("gitlab-org", "gitlab-foss", 33, {
        page: 2,
        perPage: 2,
      });

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        "/projects/278964/merge_requests/33/diffs",
        { query: { page: 2, per_page: 2 } },
      );
      expect(result).toEqual({
        items: [
          {
            path: "src/auth.ts",
            status: "modified",
            additions: 3,
            deletions: 2,
          },
          {
            path: "generated.js",
            status: "modified",
            additions: null,
            deletions: null,
          },
        ],
        totalCount: 4,
        hasNextPage: true,
        nextPage: 3,
      });
    });
  });

  describe("pullRequests.listChecks", () => {
    it("reads and normalizes merge-request pipelines", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glMergeRequest);
      mocks.rawFetch.mockResolvedValueOnce({
        data: [
          { ...glPipeline, id: 8999, sha: "stale-revision" },
          { ...glPipeline, sha: glMergeRequest.sha, status: "running" },
        ],
        headers: glHeaders(),
      });
      mocks.client.mockResolvedValueOnce({ ...glPipeline, name: "verify", status: "running" });

      const result = await gl.pullRequests.listChecks("gitlab-org", "gitlab-foss", 33, {
        perPage: 2,
      });

      expect(mocks.rawFetch).toHaveBeenCalledWith(
        mocks.client,
        "/projects/278964/merge_requests/33/pipelines",
        { query: { page: 1, per_page: 100 } },
      );
      expect(mocks.client).toHaveBeenCalledWith("/projects/278964/pipelines/9001");
      expect(mocks.client).not.toHaveBeenCalledWith("/projects/278964/pipelines/8999");
      expect(result).toEqual({
        items: [
          {
            id: "9001",
            name: "verify",
            status: "in_progress",
            conclusion: null,
            url: "https://gitlab.com/gitlab-org/gitlab-foss/-/pipelines/9001",
          },
        ],
        hasNextPage: false,
        nextPage: undefined,
      });
    });

    it("walks stale pipeline pages to preserve normalized pagination", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glMergeRequest);
      mocks.rawFetch
        .mockResolvedValueOnce({
          data: [{ ...glPipeline, sha: "stale-revision" }],
          headers: glHeaders({ nextPage: "2" }),
        })
        .mockResolvedValueOnce({
          data: [
            { ...glPipeline, sha: glMergeRequest.sha },
            { ...glPipeline, id: 9002, sha: glMergeRequest.sha },
          ],
          headers: glHeaders(),
        });
      mocks.client.mockResolvedValueOnce({ ...glPipeline, name: null });

      const result = await gl.pullRequests.listChecks("gitlab-org", "gitlab-foss", 33, {
        perPage: 1,
      });

      expect(mocks.rawFetch).toHaveBeenNthCalledWith(
        1,
        mocks.client,
        "/projects/278964/merge_requests/33/pipelines",
        { query: { page: 1, per_page: 100 } },
      );
      expect(mocks.rawFetch).toHaveBeenNthCalledWith(
        2,
        mocks.client,
        "/projects/278964/merge_requests/33/pipelines",
        { query: { page: 2, per_page: 100 } },
      );
      expect(result).toMatchObject({
        items: [expect.objectContaining({ id: "9001" })],
        hasNextPage: true,
        nextPage: 2,
      });
    });

    it("uses stable fallbacks when the pipeline has no name and no URL", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glMergeRequest);
      mocks.rawFetch.mockResolvedValueOnce({
        data: [{ ...glPipeline, sha: glMergeRequest.sha, web_url: null }],
        headers: glHeaders(),
      });
      mocks.client.mockResolvedValueOnce({ ...glPipeline, name: null, web_url: null });

      const result = await gl.pullRequests.listChecks("gitlab-org", "gitlab-foss", 33);

      expect(result.items[0]).toMatchObject({ name: "pipeline", url: "" });
    });

    it("reads the name of a fork pipeline from the fork", async () => {
      const forkPipeline = { ...glPipeline, project_id: 41372369, sha: glMergeRequest.sha };
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glMergeRequest);
      mocks.rawFetch.mockResolvedValueOnce({ data: [forkPipeline], headers: glHeaders() });
      mocks.client.mockResolvedValueOnce({
        ...forkPipeline,
        name: "Ruby 3.3.12 MR (community contribution)",
      });

      const result = await gl.pullRequests.listChecks("gitlab-org", "gitlab-foss", 33);

      expect(mocks.client).toHaveBeenCalledWith("/projects/41372369/pipelines/9001");
      expect(result.items).toEqual([
        {
          id: "9001",
          name: "Ruby 3.3.12 MR (community contribution)",
          status: "completed",
          conclusion: "failure",
          url: "https://gitlab.com/gitlab-org/gitlab-foss/-/pipelines/9001",
        },
      ]);
    });

    it("keeps every listed pipeline whose name lookup fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glMergeRequest);
      mocks.rawFetch.mockResolvedValueOnce({
        data: [
          { ...glPipeline, sha: glMergeRequest.sha },
          { ...glPipeline, id: 9002, project_id: 41372369, sha: glMergeRequest.sha },
          { ...glPipeline, id: 9003, sha: glMergeRequest.sha },
          { ...glPipeline, id: 9004, sha: glMergeRequest.sha },
        ],
        headers: glHeaders(),
      });
      mocks.client
        .mockResolvedValueOnce({ ...glPipeline, name: "Ruby 3.3.12 MR" })
        .mockRejectedValueOnce(makeFetchError(403))
        .mockRejectedValueOnce(makeFetchError(404))
        .mockRejectedValueOnce(makeFetchError(429));

      const result = await gl.pullRequests.listChecks("gitlab-org", "gitlab-foss", 33);

      expect(result.items.map((check) => [check.id, check.name])).toEqual([
        ["9001", "Ruby 3.3.12 MR"],
        ["9002", "pipeline"],
        ["9003", "pipeline"],
        ["9004", "pipeline"],
      ]);
      expect(warn).toHaveBeenCalledTimes(3);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("pipeline 9004"));
    });

    it("reads the pipeline name again on every call", async () => {
      mockProjectResolve(278964);
      for (const name of ["Ruby 3.3.12 MR", "Ruby 3.3.12 MR [renamed]"]) {
        mocks.client.mockResolvedValueOnce(glMergeRequest);
        mocks.rawFetch.mockResolvedValueOnce({
          data: [{ ...glPipeline, sha: glMergeRequest.sha }],
          headers: glHeaders(),
        });
        mocks.client.mockResolvedValueOnce({ ...glPipeline, name });

        const result = await gl.pullRequests.listChecks("gitlab-org", "gitlab-foss", 33);

        expect(result.items[0]?.name).toBe(name);
      }
      expect(mocks.cachedFetch).not.toHaveBeenCalled();
    });

    it("reads at most five pipeline names at a time", async () => {
      const rows = Array.from({ length: 7 }, (_, index) => ({
        ...glPipeline,
        id: 9100 + index,
        sha: glMergeRequest.sha,
      }));
      let inFlight = 0;
      let peak = 0;
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glMergeRequest);
      mocks.rawFetch.mockResolvedValueOnce({ data: rows, headers: glHeaders() });
      mocks.client.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return { ...glPipeline, name: null };
      });

      const result = await gl.pullRequests.listChecks("gitlab-org", "gitlab-foss", 33);

      expect(mocks.client).toHaveBeenCalledTimes(9);
      expect(peak).toBe(5);
      expect(result.items.map((check) => check.id)).toEqual(rows.map((row) => String(row.id)));
    });

    it("keeps the merged results pipeline GitLab evaluates for the head", async () => {
      const mergeRef = "refs/merge-requests/33/merge";
      const headPipeline = { ...glPipeline, id: 9003, sha: "merge-commit-revision", ref: mergeRef };
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce({ ...glMergeRequest, head_pipeline: headPipeline });
      mocks.rawFetch.mockResolvedValueOnce({
        data: [
          { ...headPipeline, status: "success" },
          { ...glPipeline, id: 9002, sha: "previous-merge-commit", ref: mergeRef },
          { ...glPipeline, sha: glMergeRequest.sha, status: "running" },
        ],
        headers: glHeaders(),
      });
      mocks.client
        .mockResolvedValueOnce({ ...headPipeline, name: "Ruby 3.3.12 MR" })
        .mockResolvedValueOnce({ ...glPipeline, name: null });

      const result = await gl.pullRequests.listChecks("gitlab-org", "gitlab-foss", 33);

      expect(mocks.client).toHaveBeenCalledWith("/projects/278964/merge_requests/33");
      expect(mocks.client).toHaveBeenCalledWith("/projects/278964/pipelines/9003");
      expect(mocks.client).toHaveBeenCalledWith("/projects/278964/pipelines/9001");
      expect(result.items.map((check) => [check.id, check.conclusion])).toEqual([
        ["9003", "success"],
        ["9001", null],
      ]);
    });
  });

  describe("pullRequests.listReviews", () => {
    const approvals = {
      approved_by: [
        {
          user: { id: 1758950, username: "iamricecake" },
          approved_at: "2026-09-17T10:33:05.619Z",
        },
      ],
    };
    const reviewers = [
      { user: { id: 1758950, username: "iamricecake" }, state: "reviewed" },
      { user: { id: 21826781, username: "GitLabDuo" }, state: "reviewed" },
      { user: { id: 2293, username: "brodock" }, state: "requested_changes" },
      { user: { id: 4, username: "waiting" }, state: "unreviewed" },
      { user: { id: 5, username: "withdrew" }, state: "unapproved" },
      { user: { id: 6, username: "ancient" } },
      { user: { id: 7, username: "drafting" }, state: "review_started" },
    ];

    it("merges approvals with each reviewer's stance, approvals first", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(approvals).mockResolvedValueOnce(reviewers);

      const result = await gl.pullRequests.listReviews("gitlab-org", "gitlab-foss", 33);

      expect(mocks.client).toHaveBeenCalledWith("/projects/278964/merge_requests/33/approvals");
      expect(mocks.client).toHaveBeenCalledWith("/projects/278964/merge_requests/33/reviewers");
      expect(result).toEqual({
        items: [
          {
            id: "1758950",
            state: "approved",
            body: "",
            author: { login: "iamricecake" },
            revision: "",
            submittedAt: "2026-09-17T10:33:05.619Z",
            url: "",
          },
          {
            id: "21826781",
            state: "commented",
            body: "",
            author: { login: "GitLabDuo" },
            revision: "",
            submittedAt: "",
            url: "",
          },
          {
            id: "2293",
            state: "changes_requested",
            body: "",
            author: { login: "brodock" },
            revision: "",
            submittedAt: "",
            url: "",
          },
          {
            id: "5",
            state: "dismissed",
            body: "",
            author: { login: "withdrew" },
            revision: "",
            submittedAt: "",
            url: "",
          },
          {
            id: "7",
            state: "pending",
            body: "",
            author: { login: "drafting" },
            revision: "",
            submittedAt: "",
            url: "",
          },
        ],
        totalCount: 5,
        hasNextPage: false,
        nextPage: undefined,
      });
    });

    it("cuts the page locally because neither endpoint paginates", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(approvals).mockResolvedValueOnce(reviewers);

      const result = await gl.pullRequests.listReviews("gitlab-org", "gitlab-foss", 33, {
        page: 2,
        perPage: 3,
      });

      expect(result).toMatchObject({
        items: [
          expect.objectContaining({ id: "5", state: "dismissed" }),
          expect.objectContaining({ id: "7", state: "pending" }),
        ],
        totalCount: 5,
        hasNextPage: false,
      });
    });

    it("reports a next page when the stances run past it", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(approvals).mockResolvedValueOnce(reviewers);

      const result = await gl.pullRequests.listReviews("gitlab-org", "gitlab-foss", 33, {
        perPage: 3,
      });

      expect(result.items.map((review) => review.id)).toEqual(["1758950", "21826781", "2293"]);
      expect(result).toMatchObject({ hasNextPage: true, nextPage: 2 });
    });
  });

  describe("releases", () => {
    const glRelease = {
      tag_name: "v1.118.0",
      name: "v1.118.0",
      description: "## Changelog",
      created_at: "2026-09-15T12:29:10.343Z",
      released_at: "2026-09-15T12:29:10.343Z",
      upcoming_release: false,
      author: { id: 40269453, username: "service-code-review-glab" },
      commit: { id: "570955d4252f860d6b0cbf3fd2ec44f86a7e6957" },
      _links: { self: "https://gitlab.com/gitlab-org/cli/-/releases/v1.118.0" },
    };
    const release = {
      id: "v1.118.0",
      tag: "v1.118.0",
      name: "v1.118.0",
      body: "## Changelog",
      draft: false,
      prerelease: false,
      author: { login: "service-code-review-glab" },
      createdAt: "2026-09-15T12:29:10.343Z",
      publishedAt: "2026-09-15T12:29:10.343Z",
      url: "https://gitlab.com/gitlab-org/cli/-/releases/v1.118.0",
    };

    it("lists releases keyed by tag and pages by x-next-page", async () => {
      mockProjectResolve(278964);
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glRelease, { ...glRelease, tag_name: "v1.117.0", name: null, description: null }],
        headers: glHeaders({ nextPage: "2", total: "157" }),
      });

      const result = await gl.releases.list("gitlab-org", "cli", { perPage: 2 });

      expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/projects/278964/releases", {
        query: { page: 1, per_page: 2 },
      });
      expect(result).toEqual({
        items: [release, { ...release, id: "v1.117.0", tag: "v1.117.0", name: "", body: "" }],
        totalCount: 157,
        hasNextPage: true,
        nextPage: 2,
      });
    });

    it("reads one release by its tag, slash and all", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce({
        ...glRelease,
        tag_name: "release/1.118",
        author: null,
        _links: null,
      });

      const result = await gl.releases.get("gitlab-org", "cli", "release/1.118");

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/releases/release%2F1.118");
      expect(result).toEqual({
        ...release,
        id: "release/1.118",
        tag: "release/1.118",
        author: { login: "" },
        url: "",
      });
    });

    it("creates a release with description and ref", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glRelease);

      await gl.releases.create("gitlab-org", "cli", {
        tag: "v1.118.0",
        name: "v1.118.0",
        body: "## Changelog",
        ref: "main",
      });

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/releases", {
        method: "POST",
        body: { tag_name: "v1.118.0", ref: "main", name: "v1.118.0", description: "## Changelog" },
      });
    });

    it("updates a release by tag with PUT, slash encoded", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce({
        ...glRelease,
        tag_name: "release/1.118",
        description: "edited",
      });

      const result = await gl.releases.update("gitlab-org", "cli", "release/1.118", {
        body: "edited",
      });

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/releases/release%2F1.118", {
        method: "PUT",
        body: { name: undefined, description: "edited" },
      });
      expect(result).toEqual({
        ...release,
        id: "release/1.118",
        tag: "release/1.118",
        body: "edited",
      });
    });

    it.each([
      ["draft", { draft: true }],
      ["prerelease", { prerelease: true }],
    ])("refuses a %s release instead of publishing it", async (_flag, flags) => {
      const error = await gl.releases
        .create("gitlab-org", "cli", { tag: "v2.0.0", ...flags })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForgesError);
      expect((error as ForgesError).status).toBe(501);
      await expect(gl.releases.update("gitlab-org", "cli", "v2.0.0", flags)).rejects.toMatchObject({
        status: 501,
      });
      expect(mocks.client).not.toHaveBeenCalled();
    });

    it("answers an update that only clears absent flags with a read", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glRelease);

      const result = await gl.releases.update("gitlab-org", "cli", "v1.118.0", {
        draft: false,
        prerelease: false,
      });

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/releases/v1.118.0");
      expect(result).toEqual(release);
    });
  });

  describe("pullRequests.search", () => {
    it("searches project merge requests with text, state, and pagination", async () => {
      mockProjectResolve(278964);
      mocks.rawFetch.mockResolvedValueOnce({
        data: [glMergedMR],
        headers: glHeaders({ nextPage: "3", total: "7" }),
      });

      const result = await gl.pullRequests.search("gitlab-org", "gitlab-foss", "runner timeout", {
        state: "closed",
        page: 2,
        perPage: 1,
      });

      expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/projects/278964/merge_requests", {
        query: {
          search: "runner timeout",
          state: "closed",
          page: 2,
          per_page: 1,
        },
      });
      expect(result).toMatchObject({
        items: [
          {
            number: 34,
            merged: true,
            draft: false,
          },
        ],
        incomplete: false,
        totalCount: 7,
        hasNextPage: true,
        nextPage: 3,
      });
      expect(result.items[0]).not.toHaveProperty("sourceBranch");
      expect(result.items[0]).not.toHaveProperty("headSha");
    });
  });

  describe("pullRequests.get", () => {
    it("lists what closes_issues reports when asked", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce(glMergedMR);
      mocks.rawFetch
        .mockResolvedValueOnce({
          data: [
            {
              iid: 12,
              title: "Crash on save",
              state: "opened",
              web_url: "https://gitlab.com/gitlab-org/gitlab-foss/-/issues/12",
            },
            { id: "JIRA-5", title: "External ticket" },
          ],
          headers: glHeaders({ nextPage: "2" }),
        })
        .mockResolvedValueOnce({
          data: [
            {
              iid: 13,
              title: "Done already",
              state: "closed",
              web_url: "https://gitlab.com/gitlab-org/gitlab-foss/-/issues/13",
            },
          ],
          headers: glHeaders({ nextPage: "" }),
        });

      const pr = await gl.pullRequests.get("o", "r", 34, { closingIssues: true });

      expect(pr.number).toBe(34);
      expect(pr.closingIssues).toEqual([
        {
          number: 12,
          title: "Crash on save",
          state: "open",
          url: "https://gitlab.com/gitlab-org/gitlab-foss/-/issues/12",
        },
        {
          number: 13,
          title: "Done already",
          state: "closed",
          url: "https://gitlab.com/gitlab-org/gitlab-foss/-/issues/13",
        },
      ]);
      expect(mocks.rawFetch).toHaveBeenNthCalledWith(
        1,
        mocks.client,
        "/projects/278964/merge_requests/34/closes_issues",
        { query: { page: 1, per_page: 100 } },
      );
      expect(mocks.rawFetch).toHaveBeenNthCalledWith(
        2,
        mocks.client,
        "/projects/278964/merge_requests/34/closes_issues",
        { query: { page: 2, per_page: 100 } },
      );
      // One project lookup serves both concurrent reads.
      expect(mocks.client).toHaveBeenCalledTimes(2);
    });

    it("makes no closes_issues request by default", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce(glMergedMR);

      const pr = await gl.pullRequests.get("o", "r", 34);

      expect(pr).not.toHaveProperty("closingIssues");
      expect(mocks.rawFetch).not.toHaveBeenCalled();
    });

    it("returns mapped merge request as pull request", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce(glMergedMR);

      const pr = await gl.pullRequests.get("o", "r", 34);

      expect(pr.merged).toBe(true);
      expect(pr.state).toBe("closed");
      expect(pr.assignees).toEqual([{ login: "maintainer" }]);
      expect(pr.mergeCommitSha).toBe("cd9bbd8a3e8af73864ca3c7704211309fae8ce0e");
      expect(pr.headSha).toBe("9a6b45222d6f39adda15a820060d9d65adab2359");
      expect(pr.mergeable).toBe(true);
      expect(pr.mergeStatus).toBe("ci_must_pass");
      expect(pr.url).toBe("https://gitlab.com/gitlab-org/gitlab-foss/-/merge_requests/34");
    });

    it("reports when and by whom a merge request was merged", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        ...glMergedMR,
        merge_user: { username: "maintainer" },
        merged_by: { username: "maintainer" },
      });

      const pr = await gl.pullRequests.get("o", "r", 34);

      expect(pr.mergedAt).toBe("2024-03-12T10:00:00Z");
      expect(pr.mergedBy).toEqual({ login: "maintainer" });
    });

    it("falls back to the deprecated merged_by", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({ ...glMergedMR, merged_by: { username: "maintainer" } });

      const pr = await gl.pullRequests.get("o", "r", 34);

      expect(pr.mergedBy).toEqual({ login: "maintainer" });
    });

    it("ignores the merge user queued on an unmerged merge request", async () => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        ...glMergeRequest,
        merge_when_pipeline_succeeds: true,
        merge_user: { username: "maintainer" },
      });

      const pr = await gl.pullRequests.get("o", "r", 33);

      expect(pr.mergedAt).toBeNull();
      expect(pr.mergedBy).toBeNull();
    });

    it.each([
      ["cannot_be_merged", "conflict", false],
      ["unchecked", "checking", null],
    ])("maps merge status %s to %s", async (mergeStatus, detailedMergeStatus, mergeable) => {
      mockProjectResolve();
      mocks.client.mockResolvedValueOnce({
        ...glMergeRequest,
        merge_status: mergeStatus,
        detailed_merge_status: detailedMergeStatus,
      });

      const pr = await gl.pullRequests.get("o", "r", 33);

      expect(pr.mergeable).toBe(mergeable);
      expect(pr.mergeStatus).toBe(detailedMergeStatus);
    });

    it("reads current state on every call", async () => {
      mockProjectResolve(278964);
      mocks.cachedFetch.mockResolvedValue(glMergeRequest);
      mocks.client
        .mockResolvedValueOnce(glMergeRequest)
        .mockResolvedValueOnce({ ...glMergedMR, iid: 33 });

      await gl.pullRequests.get("gitlab-org", "gitlab-foss", 33);
      const pr = await gl.pullRequests.get("gitlab-org", "gitlab-foss", 33);

      expect(pr.merged).toBe(true);
      expect(pr.mergeCommitSha).toBe("cd9bbd8a3e8af73864ca3c7704211309fae8ce0e");
      expect(mocks.client).toHaveBeenCalledTimes(3);
      expect(mocks.cachedFetch).not.toHaveBeenCalled();
    });
  });

  describe("pullRequests.create", () => {
    it("maps fields and multiple assignees to the GitLab API", async () => {
      mockProjectResolve(278964);
      mocks.client
        .mockResolvedValueOnce([{ ...glUserSearchHit, id: 9, username: "maintainer" }])
        .mockResolvedValueOnce([{ ...glUserSearchHit, id: 10, username: "reviewer" }])
        .mockResolvedValueOnce(glMergeRequest);

      const pr = await gl.pullRequests.create("gitlab-org", "gitlab-foss", {
        title: "New MR",
        body: "Description",
        sourceBranch: "feature/x",
        targetBranch: "main",
        assignees: ["maintainer", "reviewer"],
      });

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/merge_requests", {
        method: "POST",
        body: expect.objectContaining({
          title: "New MR",
          description: "Description",
          source_branch: "feature/x",
          target_branch: "main",
          assignee_ids: [9, 10],
        }),
      });
      expect(pr.assignees).toEqual([{ login: "maintainer" }]);
      expect(pr.url).toBe("https://gitlab.com/gitlab-org/gitlab-foss/-/merge_requests/33");
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

  describe("pullRequests.update", () => {
    const mr = "/projects/278964/merge_requests/33";

    it("sends only the changed fields in one PUT", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce({
        ...glMergeRequest,
        state: "closed",
        labels: ["refactor", "docs"],
      });

      const pr = await gl.pullRequests.update("gitlab-org", "gitlab-foss", 33, {
        body: "New description",
        state: "closed",
        addLabels: ["docs", "api"],
        removeLabels: ["stale"],
      });

      expect(mocks.client).toHaveBeenLastCalledWith(mr, {
        method: "PUT",
        body: {
          description: "New description",
          state_event: "close",
          add_labels: "docs,api",
          remove_labels: "stale",
        },
      });
      expect(mocks.client).toHaveBeenCalledTimes(2);
      expect(pr.state).toBe("closed");
    });

    it("removes a dot-named label, which travels in the body rather than a path", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glMergeRequest);

      await gl.pullRequests.update("gitlab-org", "gitlab-foss", 33, { removeLabels: ["."] });

      expect(mocks.client).toHaveBeenLastCalledWith(mr, {
        method: "PUT",
        body: { remove_labels: "." },
      });
    });

    it("refuses a comma in a label name before any request, since GitLab would split it", async () => {
      await expect(
        gl.pullRequests.update("gitlab-org", "gitlab-foss", 33, {
          title: "Renamed",
          addLabels: ["frontend,backend"],
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("frontend,backend"),
      });
      expect(mocks.client).not.toHaveBeenCalled();
    });

    it("reopens with the reopen state event", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glMergeRequest);

      await gl.pullRequests.update("gitlab-org", "gitlab-foss", 33, { state: "open" });

      expect(mocks.client).toHaveBeenLastCalledWith(mr, {
        method: "PUT",
        body: { state_event: "reopen" },
      });
    });

    it("keeps the current assignees and resolves only the added one", async () => {
      mockProjectResolve(278964);
      mocks.client
        .mockResolvedValueOnce({
          ...glMergeRequest,
          assignees: [
            { id: 9, username: "maintainer" },
            { id: 11, username: "former" },
          ],
        })
        .mockResolvedValueOnce([{ ...glUserSearchHit, id: 10, username: "reviewer" }])
        .mockResolvedValueOnce(glMergeRequest);

      await gl.pullRequests.update("gitlab-org", "gitlab-foss", 33, {
        addAssignees: ["reviewer"],
        removeAssignees: ["Former"],
      });

      expect(mocks.client).toHaveBeenNthCalledWith(2, mr);
      expect(mocks.client).toHaveBeenNthCalledWith(3, "/users", {
        query: { username: "reviewer" },
      });
      expect(mocks.client).toHaveBeenLastCalledWith(mr, {
        method: "PUT",
        body: { assignee_ids: [9, 10] },
      });
    });

    it("looks up a current assignee the response names without an id instead of dropping them", async () => {
      mockProjectResolve(278964);
      mocks.client
        .mockResolvedValueOnce(glMergeRequest)
        .mockResolvedValueOnce([{ ...glUserSearchHit, id: 9, username: "maintainer" }])
        .mockResolvedValueOnce([{ ...glUserSearchHit, id: 10, username: "reviewer" }])
        .mockResolvedValueOnce(glMergeRequest);

      await gl.pullRequests.update("gitlab-org", "gitlab-foss", 33, {
        addAssignees: ["reviewer"],
      });

      expect(mocks.client).toHaveBeenLastCalledWith(mr, {
        method: "PUT",
        body: { assignee_ids: [9, 10] },
      });
    });

    it("unassigns everyone with assignee_id 0 when the last one is removed", async () => {
      mockProjectResolve(278964);
      mocks.client
        .mockResolvedValueOnce({
          ...glMergeRequest,
          assignees: [{ id: 9, username: "maintainer" }],
        })
        .mockResolvedValueOnce({ ...glMergeRequest, assignees: [] });

      const pr = await gl.pullRequests.update("gitlab-org", "gitlab-foss", 33, {
        removeAssignees: ["maintainer"],
      });

      expect(mocks.client).toHaveBeenLastCalledWith(mr, {
        method: "PUT",
        body: { assignee_id: 0 },
      });
      expect(pr.assignees).toEqual([]);
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

  describe("pullRequests.getComment", () => {
    it("reads one note scoped to its merge request", async () => {
      mockProjectResolve(278964);
      mocks.client.mockResolvedValueOnce(glNote);

      const comment = await gl.pullRequests.getComment("gitlab-org", "gitlab-foss", 8, "2201");

      expect(mocks.client).toHaveBeenLastCalledWith("/projects/278964/merge_requests/8/notes/2201");
      expect(comment.id).toBe("2201");
    });
  });

  // --- Users ---

  describe("users.get", () => {
    it("resolves the username to an id and reads the full profile", async () => {
      mocks.client.mockResolvedValueOnce([glUserSearchHit]);
      mocks.client.mockResolvedValueOnce(glUser);

      const user = await gl.users.get("johndoe");

      expect(mocks.client).toHaveBeenCalledWith("/users", {
        query: { username: "johndoe" },
      });
      expect(mocks.client).toHaveBeenCalledWith(`/users/${glUser.id}`);
      expect(user).toMatchObject({
        id: "1234",
        login: "johndoe",
        name: "John Doe",
        email: "john@example.com",
        bio: "Backend developer",
        company: "Acme",
        location: "Berlin",
        website: "https://johndoe.dev",
        followers: 5,
        following: 3,
        createdAt: "2012-05-23T08:00:58Z",
        url: "https://gitlab.com/johndoe",
      });
    });

    it("reads the current profile on every call", async () => {
      const edited = { ...glUser, name: "Jane Doe" };
      mocks.cachedFetch.mockImplementation((_client, url) =>
        Promise.resolve(url === "/users" ? [glUserSearchHit] : glUser),
      );
      mocks.client
        .mockResolvedValueOnce([glUserSearchHit])
        .mockResolvedValueOnce(glUser)
        .mockResolvedValueOnce([glUserSearchHit])
        .mockResolvedValueOnce(edited);

      await gl.users.get("johndoe");
      const user = await gl.users.get("johndoe");

      expect(user.name).toBe("Jane Doe");
      expect(mocks.client).toHaveBeenCalledTimes(4);
      expect(mocks.cachedFetch).not.toHaveBeenCalled();
    });

    it("falls back to public_email when email is hidden as an empty string", async () => {
      mocks.client.mockResolvedValueOnce([glUserSearchHit]);
      mocks.client.mockResolvedValueOnce({
        ...glUser,
        email: "",
        public_email: "jane@example.com",
      });

      const user = await gl.users.get("johndoe");

      expect(user.email).toBe("jane@example.com");
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

    it("reads the current authenticated identity on every call", async () => {
      const switched = { ...glUser, id: 5678, username: "janedoe" };
      mocks.cachedFetch.mockResolvedValue(glUser);
      mocks.client.mockResolvedValueOnce(glUser).mockResolvedValueOnce(switched);

      await gl.users.authenticated();
      const user = await gl.users.authenticated();

      expect(user.login).toBe("janedoe");
      expect(mocks.client).toHaveBeenCalledTimes(2);
      expect(mocks.cachedFetch).not.toHaveBeenCalled();
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

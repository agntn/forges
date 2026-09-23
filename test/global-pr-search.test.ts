import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FetchError } from "ofetch";
import { GitHubProvider } from "../src/providers/github.ts";
import { GitLabProvider } from "../src/providers/gitlab.ts";
import { GiteaProvider } from "../src/providers/gitea.ts";

const mocks = vi.hoisted(() => ({ client: vi.fn(), rawFetch: vi.fn() }));
vi.mock("../src/http.ts", () => ({
  createHttpClient: () => mocks.client,
  rawFetch: mocks.rawFetch,
}));

const hit = {
  id: 123,
  number: 4,
  title: "Fix search",
  body: "Details",
  state: "closed",
  labels: [],
  user: { login: "contributor" },
  created_at: "2026-09-20T00:00:00Z",
  updated_at: "2026-09-21T00:00:00Z",
  html_url: "https://github.com/other/project/pull/4",
  repository_url: "https://api.github.com/repos/other/project",
  pull_request: { merged_at: "2026-09-21T00:00:00Z" },
  draft: false,
};

function makeFetchError(status: number): FetchError {
  const error = new FetchError("Rejected");
  Object.defineProperty(error, "status", { value: status });
  return error;
}

beforeEach(() => vi.resetAllMocks());

describe("global pull-request search", () => {
  it("retains two repositories and forwards native qualifiers and ordering", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: {
        items: [hit, { ...hit, repository_url: "https://host/api/v3/repos/Second/Repo" }],
        total_count: 3,
        incomplete_results: false,
      },
      headers: new Headers({ link: '<https://api.github.com/search/issues?page=2>; rel="next"' }),
    });
    const query = "author:contributor created:>=2026-09-01";
    const result = await new GitHubProvider({ token: "" }).pullRequests.searchGlobal(query, {
      sort: "created",
      order: "desc",
      perPage: 2,
    });
    expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/search/issues", {
      query: { q: `${query} is:pr`, sort: "created", order: "desc", per_page: "2", page: "1" },
    });
    expect(result.items.map((item) => item.repository)).toEqual(["other/project", "Second/Repo"]);
    expect(result.items[0]).toMatchObject({
      number: 4,
      body: "Details",
      merged: true,
      draft: false,
    });
    expect(result).toMatchObject({
      hasNextPage: true,
      nextPage: 2,
      totalCount: 3,
      incomplete: false,
      resultLimit: 1000,
    });
  });

  it.each([
    { owner: "OTHER", qualifier: "user:OTHER" },
    { owner: "OTHER", repo: "PROJECT", qualifier: "repo:OTHER/PROJECT" },
  ])(
    "enforces scope and removes issues or missing repository identities: %j",
    async ({ qualifier, ...scope }) => {
      mocks.rawFetch.mockResolvedValue({
        data: {
          items: [
            hit,
            { ...hit, repository_url: "https://api.github.com/repos/outside/project" },
            { ...hit, repository_url: "https://api.github.com/repos/other/sibling" },
            { ...hit, pull_request: undefined },
            { ...hit, repository_url: "garbage" },
            { ...hit, repository_url: undefined },
          ],
          total_count: 6,
          incomplete_results: false,
        },
        headers: new Headers(),
      });
      const result = await new GitHubProvider({ token: "" }).pullRequests.searchGlobal(
        "author:contributor",
        scope,
      );
      expect(result.items.map((item) => item.repository)).toEqual(
        "repo" in scope ? ["other/project"] : ["other/project", "other/sibling"],
      );
      expect(result.incomplete).toBe(true);
      expect(mocks.rawFetch.mock.calls[0]?.[2].query.q).toBe(
        `author:contributor is:pr ${qualifier}`,
      );
    },
  );

  it.each([true, false])(
    "preserves empty results and provider incompleteness (%s)",
    async (incomplete) => {
      mocks.rawFetch.mockResolvedValue({
        data: { items: [], total_count: 0, incomplete_results: incomplete },
        headers: new Headers(),
      });
      expect(
        await new GitHubProvider({ token: "" }).pullRequests.searchGlobal("author:contributor"),
      ).toMatchObject({
        items: [],
        totalCount: 0,
        incomplete,
        hasNextPage: false,
        resultLimit: 1000,
      });
    },
  );

  it("trims the final page before filtering and stops at the result cap", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: {
        items: [{ ...hit, pull_request: undefined }, ...Array.from({ length: 29 }, () => hit)],
        total_count: 1200,
        incomplete_results: false,
      },
      headers: new Headers({ link: '<https://api.github.com/search/issues?page=35>; rel="next"' }),
    });
    const result = await new GitHubProvider({ token: "" }).pullRequests.searchGlobal(
      "author:contributor",
      { page: 34 },
    );
    expect(result.items).toHaveLength(9);
    expect(result).toMatchObject({
      hasNextPage: false,
      incomplete: true,
      totalCount: 1200,
      resultLimit: 1000,
    });
    expect(result.nextPage).toBeUndefined();
  });

  it("rejects invalid scope and pagination before transport", async () => {
    const resource = new GitHubProvider({ token: "" }).pullRequests;
    await expect(resource.searchGlobal(" ")).rejects.toMatchObject({ status: 400 });
    for (const options of [
      { repo: "x" },
      { owner: "bad owner" },
      { owner: "ok", repo: "bad:repo" },
      { author: "two words" },
      { author: "author:x" },
      { page: 0 },
      { page: 1.5 },
      { page: 35 },
      { perPage: 101 },
      { perPage: Number.NaN },
    ]) {
      await expect(resource.searchGlobal("author:contributor", options)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(mocks.rawFetch).not.toHaveBeenCalled();
  });

  it("adds author as a qualifier, with or without keywords", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: { items: [], total_count: 0 },
      headers: new Headers(),
    });
    const resource = new GitHubProvider({ token: "" }).pullRequests;
    await resource.searchGlobal("fix", { author: "contributor" });
    await resource.searchGlobal("", { author: "contributor" });
    expect(mocks.rawFetch.mock.calls.map(([, , options]) => options.query.q)).toEqual([
      "fix is:pr author:contributor",
      "is:pr author:contributor",
    ]);
  });

  it.each([401, 404, 405])(
    "normalizes HTTP %s without hiding authentication failures",
    async (status) => {
      const error = new FetchError("Rejected");
      Object.defineProperty(error, "status", { value: status });
      mocks.rawFetch.mockRejectedValue(error);
      await expect(
        new GitHubProvider({ token: "" }).pullRequests.searchGlobal("author:contributor"),
      ).rejects.toMatchObject({ status: status === 401 ? 401 : 501 });
    },
  );
});

const giteaHit = {
  id: 7,
  number: 279,
  title: "Fix search",
  body: "Details",
  state: "closed",
  labels: [],
  user: { login: "contributor" },
  assignees: null,
  created_at: "2026-09-23T12:35:30Z",
  updated_at: "2026-09-23T15:34:40Z",
  html_url: "https://gitea.com/gitea/gitea-mcp/pulls/279",
  pull_request: { merged: true, draft: false },
  repository: { id: 1, name: "gitea-mcp", owner: "gitea", full_name: "gitea/gitea-mcp" },
};

describe("Gitea global pull-request search", () => {
  it("searches every repository, all states, and keeps each hit's repository", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: [
        giteaHit,
        {
          ...giteaHit,
          number: 1,
          pull_request: { merged: false, draft: true },
          repository: { full_name: "someone/project" },
        },
      ],
      headers: new Headers({
        link: '<https://gitea.com/api/v1/repos/issues/search?limit=2&page=2&q=fix&state=all&type=pulls>; rel="next"',
        "x-total-count": "10236",
      }),
    });
    const result = await new GiteaProvider({ token: "" }).pullRequests.searchGlobal("fix", {
      perPage: 2,
    });
    expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/repos/issues/search", {
      query: { q: "fix", type: "pulls", state: "all", page: "1", limit: "2" },
    });
    expect(result.items.map((item) => [item.repository, item.merged, item.draft])).toEqual([
      ["gitea/gitea-mcp", true, false],
      ["someone/project", false, true],
    ]);
    expect(result).toMatchObject({
      hasNextPage: true,
      nextPage: 2,
      totalCount: 10236,
      incomplete: false,
      resultLimit: null,
    });
  });

  it.each([
    [{ owner: "gitea" }, "/repos/issues/search", { owner: "gitea" }],
    [{ owner: "gitea", repo: "tea" }, "/repos/gitea/tea/issues", {}],
  ])("scopes %j through %s", async (scope, path, extra) => {
    mocks.rawFetch.mockResolvedValue({ data: [], headers: new Headers() });
    const result = await new GiteaProvider({ token: "" }).pullRequests.searchGlobal("fix", scope);
    expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, path, {
      query: { q: "fix", type: "pulls", state: "all", page: "1", limit: "30", ...extra },
    });
    expect(result).toMatchObject({ items: [], hasNextPage: false, incomplete: false });
    expect(result.totalCount).toBeUndefined();
  });

  it("drops issues and hits without a repository and marks the page incomplete", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: [
        giteaHit,
        { ...giteaHit, pull_request: null },
        { ...giteaHit, repository: null },
        { ...giteaHit, repository: { full_name: "" } },
      ],
      headers: new Headers({ "x-total-count": "4" }),
    });
    const result = await new GiteaProvider({ token: "" }).pullRequests.searchGlobal("fix");
    expect(result.items.map((item) => item.repository)).toEqual(["gitea/gitea-mcp"]);
    expect(result).toMatchObject({ totalCount: 4, incomplete: true });
  });

  it("filters by author through created_by and refuses a host that ignores it", async () => {
    const resource = new GiteaProvider({ token: "" }).pullRequests;
    mocks.rawFetch.mockResolvedValueOnce({ data: [giteaHit], headers: new Headers() });
    const result = await resource.searchGlobal("", { author: "Contributor" });
    expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/repos/issues/search", {
      query: { created_by: "Contributor", type: "pulls", state: "all", page: "1", limit: "30" },
    });
    expect(result.items).toHaveLength(1);
    mocks.rawFetch.mockResolvedValueOnce({
      data: [giteaHit, { ...giteaHit, user: { login: "someone-else" } }],
      headers: new Headers(),
    });
    await expect(resource.searchGlobal("fix", { author: "contributor" })).rejects.toMatchObject({
      status: 501,
    });
  });

  it("accepts newest first and rejects any other ordering or bad page before transport", async () => {
    mocks.rawFetch.mockResolvedValue({ data: [], headers: new Headers() });
    const resource = new GiteaProvider({ token: "" }).pullRequests;
    await resource.searchGlobal("fix", { sort: "created", order: "desc" });
    expect(mocks.rawFetch).toHaveBeenCalledTimes(1);
    mocks.rawFetch.mockClear();
    for (const options of [
      { sort: "updated" as const },
      { sort: "comments" as const },
      { order: "asc" as const },
      { sort: "created" as const, order: "asc" as const },
    ]) {
      await expect(resource.searchGlobal("fix", options)).rejects.toMatchObject({ status: 501 });
    }
    for (const options of [{ page: 0 }, { perPage: 101 }, { perPage: Number.NaN }]) {
      await expect(resource.searchGlobal("fix", options)).rejects.toMatchObject({ status: 400 });
    }
    expect(mocks.rawFetch).not.toHaveBeenCalled();
  });
});

const gitlabHit = {
  id: 471955126,
  iid: 97,
  title: "Fix search",
  description: "Details",
  state: "merged",
  labels: [],
  author: { username: "eighthave" },
  assignees: [],
  created_at: "2026-06-18T13:15:54.669Z",
  updated_at: "2026-06-18T14:02:11.103Z",
  web_url: "https://gitlab.com/fdroid/issuebot/-/merge_requests/97",
  source_branch: "fix-search",
  target_branch: "master",
  merged_at: "2026-06-18T14:02:10.981Z",
  draft: false,
  merge_commit_sha: null,
  references: { short: "!97", relative: "issuebot!97", full: "fdroid/issuebot!97" },
};

describe("GitLab global pull-request search", () => {
  it("searches every project, all states, and keeps each hit's repository", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: [
        gitlabHit,
        {
          ...gitlabHit,
          iid: 3,
          state: "opened",
          merged_at: null,
          draft: true,
          references: { full: "group/sub/project!3" },
        },
      ],
      headers: new Headers({ "x-next-page": "2", "x-total": "74" }),
    });
    const result = await new GitLabProvider({ token: "" }).pullRequests.searchGlobal("fix", {
      perPage: 2,
    });
    expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/merge_requests", {
      query: {
        scope: "all",
        search: "fix",
        state: "all",
        order_by: "created_at",
        sort: "desc",
        page: "1",
        per_page: "2",
      },
      retryStatusCodes: [409, 425, 429, 500, 502, 503, 504],
    });
    expect(
      result.items.map((item) => [item.repository, item.number, item.merged, item.draft]),
    ).toEqual([
      ["fdroid/issuebot", 97, true, false],
      ["group/sub/project", 3, false, true],
    ]);
    expect(result).toMatchObject({
      hasNextPage: true,
      nextPage: 2,
      totalCount: 74,
      incomplete: false,
      resultLimit: null,
    });
  });

  it.each([
    [{ owner: "group/sub" }, "/groups/group%2Fsub/merge_requests"],
    [{ owner: "group/sub", repo: "project" }, "/projects/group%2Fsub%2Fproject/merge_requests"],
  ])("scopes %j through %s", async (scope, path) => {
    mocks.rawFetch.mockResolvedValue({ data: [], headers: new Headers() });
    const result = await new GitLabProvider({ token: "" }).pullRequests.searchGlobal("fix", scope);
    expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, path, {
      query: {
        search: "fix",
        state: "all",
        order_by: "created_at",
        sort: "desc",
        page: "1",
        per_page: "30",
      },
      retryStatusCodes: [409, 425, 429, 500, 502, 503, 504],
    });
    expect(result).toMatchObject({ items: [], hasNextPage: false, incomplete: false });
    expect(result.totalCount).toBeUndefined();
  });

  it("filters by author and orders by update", async () => {
    mocks.rawFetch.mockResolvedValue({ data: [], headers: new Headers() });
    const resource = new GitLabProvider({ token: "" }).pullRequests;
    await resource.searchGlobal("", { author: "eighthave", sort: "updated", order: "asc" });
    await resource.searchGlobal(" gradle author:eighthave ");
    expect(mocks.rawFetch.mock.calls.map(([, , options]) => options.query)).toEqual([
      expect.objectContaining({
        author_username: "eighthave",
        order_by: "updated_at",
        sort: "asc",
      }),
      expect.objectContaining({ search: "gradle author:eighthave" }),
    ]);
    expect(mocks.rawFetch.mock.calls[0]![2].query).not.toHaveProperty("search");
    expect(mocks.rawFetch.mock.calls[1]![2].query).not.toHaveProperty("author_username");
  });

  it("drops hits without a repository and marks the page incomplete", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: [
        gitlabHit,
        { ...gitlabHit, references: undefined },
        { ...gitlabHit, references: { full: "!97" } },
      ],
      headers: new Headers({ "x-total": "3" }),
    });
    const result = await new GitLabProvider({ token: "" }).pullRequests.searchGlobal("fix");
    expect(result.items.map((item) => item.repository)).toEqual(["fdroid/issuebot"]);
    expect(result).toMatchObject({ totalCount: 3, incomplete: true });
  });

  it("rejects comment ordering and bad pages before transport", async () => {
    const resource = new GitLabProvider({ token: "" }).pullRequests;
    await expect(resource.searchGlobal("fix", { sort: "comments" })).rejects.toMatchObject({
      status: 501,
    });
    for (const options of [{ page: 0 }, { perPage: 101 }, { perPage: Number.NaN }]) {
      await expect(resource.searchGlobal("fix", options)).rejects.toMatchObject({ status: 400 });
    }
    expect(mocks.rawFetch).not.toHaveBeenCalled();
  });

  it("names the next step when GitLab times out or the owner is no group", async () => {
    const resource = new GitLabProvider({ token: "" }).pullRequests;
    mocks.rawFetch.mockRejectedValueOnce(makeFetchError(408));
    await expect(resource.searchGlobal("fix")).rejects.toMatchObject({
      status: 408,
      message: expect.stringContaining("author"),
    });
    mocks.rawFetch.mockRejectedValueOnce(makeFetchError(404));
    await expect(resource.searchGlobal("fix", { owner: "someone" })).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("group"),
    });
  });
});

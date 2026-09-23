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
  sha: "abc123",
  html_url: "https://github.com/other/project/commit/abc123",
  repository: { full_name: "other/project" },
  commit: {
    message: "Fix iteration\n\nKeep a snapshot.",
    author: { name: "Contributor", email: "author@example.com", date: "2026-08-21T00:00:00Z" },
    committer: { name: "Maintainer", email: "committer@example.com", date: "2026-09-20T00:00:00Z" },
  },
  parents: [{ sha: "parent" }],
};

beforeEach(() => vi.resetAllMocks());

describe("commit search", () => {
  it("finds contributions outside the author's repositories and preserves native date queries", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: { items: [hit], total_count: 2, incomplete_results: false },
      headers: new Headers({ link: '<https://api.github.com/search/commits?page=2>; rel="next"' }),
    });
    const provider = new GitHubProvider({ token: "" });
    const query = "author:contributor committer-date:2026-08-21..2026-09-20";
    const result = await provider.commits.search(query, { perPage: 1 });
    expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/search/commits", {
      query: { q: query, page: "1", per_page: "1" },
    });
    expect(result).toEqual({
      items: [
        {
          sha: hit.sha,
          repository: "other/project",
          message: hit.commit.message,
          author: hit.commit.author,
          committer: hit.commit.committer,
          parents: ["parent"],
          url: hit.html_url,
        },
      ],
      hasNextPage: true,
      nextPage: 2,
      totalCount: 2,
      incomplete: false,
      resultLimit: 1000,
    });
  });

  it("keeps provider incompleteness separate from the searchable cap", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: { items: [hit], total_count: 2, incomplete_results: true },
      headers: new Headers(),
    });
    const result = await new GitHubProvider({ token: "" }).commits.search("snapshot");
    expect(result).toMatchObject({ incomplete: true, totalCount: 2, resultLimit: 1000 });
  });

  it("stops continuation at the 1000-result cap, including a partial final page", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: {
        items: Array.from({ length: 30 }, () => hit),
        total_count: 1200,
        incomplete_results: false,
      },
      headers: new Headers({ link: '<https://api.github.com/search/commits?page=35>; rel="next"' }),
    });
    const result = await new GitHubProvider({ token: "" }).commits.search("snapshot", { page: 34 });
    expect(result.items).toHaveLength(10);
    expect(result).toMatchObject({ hasNextPage: false, incomplete: true, resultLimit: 1000 });
    expect(result.nextPage).toBeUndefined();
  });

  it("does not fill a scoped final page with matches beyond the cap", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: {
        items: [
          { ...hit, repository: { full_name: "outside/project" } },
          ...Array.from({ length: 29 }, () => hit),
        ],
        total_count: 1200,
        incomplete_results: false,
      },
      headers: new Headers(),
    });
    const result = await new GitHubProvider({ token: "" }).commits.search("snapshot", {
      owner: "other",
      page: 34,
    });
    expect(result.items).toHaveLength(9);
    expect(result.incomplete).toBe(true);
  });

  it("applies repository scope and refuses results outside it", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: {
        items: [hit, { ...hit, repository: { full_name: "Other/Chosen" } }],
        total_count: 2,
        incomplete_results: false,
      },
      headers: new Headers(),
    });
    const result = await new GitHubProvider({ token: "" }).commits.search(
      "snapshot repo:other/project",
      {
        owner: "other",
        repo: "chosen",
        page: 2,
        perPage: 10,
      },
    );
    expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/search/commits", {
      query: { q: "snapshot repo:other/project repo:other/chosen", page: "2", per_page: "10" },
    });
    expect(result.items.map((item) => item.repository)).toEqual(["Other/Chosen"]);
    expect(result.incomplete).toBe(true);
  });

  it("supports owner scope and empty results", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: { items: [], total_count: 0, incomplete_results: false },
      headers: new Headers(),
    });
    const result = await new GitHubProvider({ token: "" }).commits.search("snapshot", {
      owner: "other",
    });
    expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/search/commits", {
      query: { q: "snapshot user:other", page: "1", per_page: "30" },
    });
    expect(result).toMatchObject({
      items: [],
      hasNextPage: false,
      incomplete: false,
      totalCount: 0,
    });
  });

  it("rejects invalid scope, pagination and pages beyond the cap before transport", async () => {
    const provider = new GitHubProvider({ token: "" });
    await expect(provider.commits.search(" ")).rejects.toMatchObject({ status: 400 });
    for (const options of [
      { repo: "x" },
      { page: 0 },
      { perPage: 101 },
      { page: 1.5 },
      { page: 35 },
      { perPage: Number.NaN },
    ]) {
      await expect(provider.commits.search("snapshot", options)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(mocks.rawFetch).not.toHaveBeenCalled();
  });

  it.each(["bad owner", "bad:owner", "bad/repo", "bad%repo", 'bad"name'])(
    "returns 400 for invalid scope %s before transport",
    async (value) => {
      const provider = new GitHubProvider({ token: "" });
      for (const resource of [provider.commits, provider.code]) {
        await expect(resource.search("snapshot", { owner: value })).rejects.toMatchObject({
          status: 400,
        });
        await expect(
          resource.search("snapshot", { owner: "valid", repo: value }),
        ).rejects.toMatchObject({ status: 400 });
      }
      expect(mocks.rawFetch).not.toHaveBeenCalled();
    },
  );

  it("preserves authentication failures instead of reporting unsupported search", async () => {
    const error = new FetchError("Unauthorized");
    Object.defineProperty(error, "status", { value: 401 });
    mocks.rawFetch.mockRejectedValue(error);
    await expect(
      new GitHubProvider({ token: "" }).commits.search("snapshot"),
    ).rejects.toMatchObject({ status: 401 });
  });

  it.each([404, 405])("reports unsupported hosts for HTTP %s", async (status) => {
    const error = new FetchError("Not available");
    Object.defineProperty(error, "status", { value: status });
    mocks.rawFetch.mockRejectedValue(error);
    await expect(
      new GitHubProvider({ token: "" }).commits.search("snapshot"),
    ).rejects.toMatchObject({ status: 501 });
  });

  it("reports unsupported providers without transport", async () => {
    await expect(new GiteaProvider({ token: "" }).commits.search("snapshot")).rejects.toMatchObject(
      { status: 501 },
    );
    expect(mocks.rawFetch).not.toHaveBeenCalled();
  });
});

/** A row as GitLab's API::Entities::CommitDetail serializes it for scope=commits. */
const gitlabHit = {
  id: "ed899a2f4b50b4370feeea94676502b42383c746",
  short_id: "ed899a2f",
  created_at: "2026-09-20T10:00:00.000+02:00",
  parent_ids: ["2a4b78934375d7f53875269ffd4f45fd83a84ebe"],
  title: "Fix iteration",
  message: "Fix iteration\n\nKeep a snapshot.\n",
  author_name: "Contributor",
  author_email: "author@example.com",
  authored_date: "2026-08-21T00:00:00.000+02:00",
  committer_name: "Maintainer",
  committer_email: "committer@example.com",
  committed_date: "2026-09-20T10:00:00.000+02:00",
  trailers: {},
  extended_trailers: {},
  web_url:
    "https://gitlab.com/gitlab-org/gitlab-runner/-/commit/ed899a2f4b50b4370feeea94676502b42383c746",
  stats: null,
  status: null,
  project_id: 250833,
  last_pipeline: null,
};

const gitlabProject = {
  id: 250833,
  path_with_namespace: "gitlab-org/gitlab-runner",
  web_url: "https://gitlab.com/gitlab-org/gitlab-runner",
};

const gitlabItem = {
  sha: gitlabHit.id,
  repository: "gitlab-org/gitlab-runner",
  message: gitlabHit.message,
  author: { name: "Contributor", email: "author@example.com", date: gitlabHit.authored_date },
  committer: { name: "Maintainer", email: "committer@example.com", date: gitlabHit.committed_date },
  parents: gitlabHit.parent_ids,
  url: gitlabHit.web_url,
};

function scopeRefusal(data: unknown): FetchError {
  const error = new FetchError("Bad Request");
  Object.defineProperty(error, "status", { value: 400 });
  Object.defineProperty(error, "data", { value: data });
  return error;
}

describe("GitLab commit search", () => {
  it("searches one project by message and names it on every row", async () => {
    mocks.client.mockResolvedValueOnce(gitlabProject);
    mocks.rawFetch.mockResolvedValue({
      data: [gitlabHit],
      headers: new Headers({ "x-next-page": "3", "x-total": "101" }),
    });

    const result = await new GitLabProvider({ token: "glpat-test" }).commits.search("snapshot", {
      owner: "gitlab-org",
      repo: "gitlab-runner",
      page: 2,
      perPage: 1,
    });

    expect(mocks.client).toHaveBeenCalledTimes(1);
    expect(mocks.client).toHaveBeenCalledWith("/projects/gitlab-org%2Fgitlab-runner");
    expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, "/projects/250833/search", {
      query: { scope: "commits", search: "snapshot", page: 2, per_page: 1 },
    });
    // x-total stops counting 100 past the earlier pages, so it is no count to report.
    expect(result).toEqual({
      items: [gitlabItem],
      hasNextPage: true,
      nextPage: 3,
      incomplete: false,
      resultLimit: null,
    });
  });

  it("keeps paging a full 100-row page at GitLab's counting cap", async () => {
    mocks.client.mockResolvedValueOnce(gitlabProject);
    mocks.rawFetch.mockResolvedValue({
      data: Array.from({ length: 100 }, () => gitlabHit),
      headers: new Headers({ "x-next-page": "", "x-total": "200" }),
    });

    const result = await new GitLabProvider({ token: "glpat-test" }).commits.search("snapshot", {
      owner: "gitlab-org",
      repo: "gitlab-runner",
      page: 2,
      perPage: 100,
    });

    expect(result).toMatchObject({ hasNextPage: true, nextPage: 3 });
  });

  it("ends on a short last page", async () => {
    mocks.client.mockResolvedValueOnce(gitlabProject);
    mocks.rawFetch.mockResolvedValue({
      data: [gitlabHit],
      headers: new Headers({ "x-next-page": "", "x-total": "101" }),
    });

    const result = await new GitLabProvider({ token: "glpat-test" }).commits.search("snapshot", {
      owner: "gitlab-org",
      repo: "gitlab-runner",
      page: 2,
      perPage: 100,
    });

    expect(result.hasNextPage).toBe(false);
    expect(result.nextPage).toBeUndefined();
  });

  it.each([
    [{}, "/search"],
    [{ owner: "gitlab-org" }, "/groups/gitlab-org/search"],
  ])("routes %o through %s and reads each hit's project", async (scope, route) => {
    mocks.rawFetch.mockResolvedValue({ data: [gitlabHit], headers: new Headers() });
    mocks.client.mockResolvedValueOnce(gitlabProject);

    const result = await new GitLabProvider({ token: "glpat-test" }).commits.search(
      "snapshot",
      scope,
    );

    expect(mocks.rawFetch).toHaveBeenCalledWith(mocks.client, route, {
      query: { scope: "commits", search: "snapshot", page: 1, per_page: 30 },
    });
    expect(mocks.client).toHaveBeenCalledWith("/projects/250833");
    expect(result).toMatchObject({ items: [gitlabItem], hasNextPage: false, incomplete: false });
  });

  it("marks a page incomplete when a hit's project cannot be read", async () => {
    mocks.rawFetch.mockResolvedValue({
      data: [gitlabHit, { ...gitlabHit, project_id: 99 }],
      headers: new Headers(),
    });
    mocks.client.mockImplementation(async (url: string) => {
      if (url === "/projects/250833") return gitlabProject;
      throw new Error("gone");
    });

    const result = await new GitLabProvider({ token: "glpat-test" }).commits.search("snapshot");

    expect(result).toMatchObject({ items: [gitlabItem], incomplete: true });
  });

  it.each([
    ["Community Edition", { error: "scope does not have a valid value" }],
    ["no advanced search", { message: "Scope supported only with advanced search" }],
  ])("answers 501 with the project route when %s refuses a wide search", async (_, data) => {
    mocks.rawFetch.mockRejectedValue(scopeRefusal(data));

    await expect(
      new GitLabProvider({ token: "glpat-test" }).commits.search("snapshot", {
        owner: "gitlab-org",
      }),
    ).rejects.toMatchObject({
      status: 501,
      platform: "gitlab",
      message: expect.stringContaining("Pass owner and repo"),
    });
  });

  it("leaves other bad requests as they are", async () => {
    mocks.client.mockResolvedValueOnce(gitlabProject);
    mocks.rawFetch.mockRejectedValue(scopeRefusal({ error: "search is invalid" }));

    await expect(
      new GitLabProvider({ token: "glpat-test" }).commits.search("snapshot", {
        owner: "gitlab-org",
        repo: "gitlab-runner",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ["page 0", { page: 0 }],
    ["perPage 101", { perPage: 101 }],
  ])("rejects %s before any request", async (_, options) => {
    await expect(
      new GitLabProvider({ token: "glpat-test" }).commits.search("snapshot", options),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.rawFetch).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
});

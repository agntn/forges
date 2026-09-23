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

  it.each([GitLabProvider, GiteaProvider])(
    "reports unsupported providers without transport",
    async (Provider) => {
      await expect(new Provider({ token: "" }).commits.search("snapshot")).rejects.toMatchObject({
        status: 501,
      });
      expect(mocks.rawFetch).not.toHaveBeenCalled();
    },
  );
});

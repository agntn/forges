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

  it.each([GitLabProvider, GiteaProvider])(
    "reports unsupported providers without transport",
    async (Provider) => {
      await expect(
        new Provider({ token: "" }).pullRequests.searchGlobal("author:contributor"),
      ).rejects.toMatchObject({ status: 501 });
      expect(mocks.rawFetch).not.toHaveBeenCalled();
    },
  );
});

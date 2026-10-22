import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createProvider } from "../src/index.ts";
import type { Provider } from "../src/provider.ts";

/** One row per check the base class runs, each with the input that trips it. */
const refusals: [string, (provider: Provider) => Promise<unknown>][] = [
  [
    "file read offset",
    (p) => p.repos.readContents({ owner: "o", repo: "r" }, { path: "a.md", offset: -1 }),
  ],
  ["file read path", (p) => p.repos.readContents({ owner: "o", repo: "r" }, { path: "../a.md" })],
  [
    "template page",
    (p) => p.contributionTemplates.list({ owner: "o", repo: "r" }, { kind: "issue", page: 0 }),
  ],
  [
    "template key",
    (p) => p.contributionTemplates.get({ owner: "o", repo: "r" }, { kind: "issue", key: "" }),
  ],
  ["code search query", (p) => p.code.search(" ")],
  ["code search scope", (p) => p.code.search("x", { repo: "r" })],
  ["CI run id", (p) => p.ciRuns.listJobs({ owner: "o", repo: "r" }, { runId: "0" })],
  ["CI job page", (p) => p.ciRuns.listJobs({ owner: "o", repo: "r" }, { runId: "1", perPage: 0 })],
  [
    "CI job log offset",
    (p) => p.ciRuns.readJobLog({ owner: "o", repo: "r" }, { jobId: "1", offset: -1 }),
  ],
  ["commit search query", (p) => p.commits.search(" ")],
  ["commit search scope", (p) => p.commits.search("x", { repo: "r" })],
  [
    "commit comparison refs",
    (p) => p.commits.compare({ owner: "o", repo: "r" }, { base: " ", head: "main" }),
  ],
  [
    "commit comparison page",
    (p) => p.commits.compare({ owner: "o", repo: "r" }, { base: "a", head: "b", page: 0 }),
  ],
  [
    "commit patch offset",
    (p) => p.commits.readPatch({ owner: "o", repo: "r" }, { sha: "abc", offset: -1 }),
  ],
  ["release read tag", (p) => p.releases.get({ owner: "o", repo: "r" }, { tag: " " })],
  ["release create tag", (p) => p.releases.create({ owner: "o", repo: "r" }, { tag: " " })],
  ["release update", (p) => p.releases.update({ owner: "o", repo: "r" }, { tag: "v1" })],
  ["global issue search", (p) => p.issues.searchGlobal(" ")],
  ["global issue labels", (p) => p.issues.searchGlobal("x", { labels: ["a,b"] })],
  ["issue search query", (p) => p.issues.search({ owner: "o", repo: "r" }, { query: " " })],
  [
    "issue assignees",
    (p) => p.issues.create({ owner: "o", repo: "r" }, { title: "t", body: "", assignees: [""] }),
  ],
  ["issue update", (p) => p.issues.update({ owner: "o", repo: "r", number: 1 }, {})],
  [
    "issue comment",
    (p) => p.issues.createComment({ owner: "o", repo: "r", number: 1 }, { body: " " }),
  ],
  [
    "issue comment page",
    (p) => p.issues.listComments({ owner: "o", repo: "r", number: 1 }, { perPage: 0 }),
  ],
  [
    "issue reaction page",
    (p) => p.issues.listReactions({ owner: "o", repo: "r", number: 1 }, { perPage: 0 }),
  ],
  ["global pull request search", (p) => p.pullRequests.searchGlobal(" ")],
  [
    "check page",
    (p) => p.pullRequests.listChecks({ owner: "o", repo: "r", number: 1 }, { page: 0 }),
  ],
  [
    "pull request search query",
    (p) => p.pullRequests.search({ owner: "o", repo: "r" }, { query: " " }),
  ],
  ["pull request update", (p) => p.pullRequests.update({ owner: "o", repo: "r", number: 1 }, {})],
  [
    "merge head",
    (p) => p.pullRequests.merge({ owner: "o", repo: "r", number: 1 }, { headSha: " " }),
  ],
  [
    "pull request comment",
    (p) => p.pullRequests.createComment({ owner: "o", repo: "r", number: 1 }, { body: " " }),
  ],
  [
    "pull request comment page",
    (p) => p.pullRequests.listComments({ owner: "o", repo: "r", number: 1 }, { page: 0 }),
  ],
  [
    "pull request reaction page",
    (p) => p.pullRequests.listReactions({ owner: "o", repo: "r", number: 1 }, { page: 0 }),
  ],
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each([
  ["github", { token: "x" }],
  ["gitlab", { token: "x" }],
  ["gitea", { token: "x", baseURL: "https://gitea.example" }],
  ["artifacts", { token: "x", accountId: "account" }],
] as const)("%s", (platform, config) => {
  it.each(refusals)("names the platform on a bad %s", async (_check, call) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(call(await createProvider(platform, config))).rejects.toMatchObject({
      status: 400,
      platform,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

it("names the platform on an operation the forge lacks", async () => {
  const artifacts = await createProvider("artifacts", { token: "x", accountId: "account" });

  await expect(artifacts.code.search("x")).rejects.toMatchObject({
    status: 501,
    platform: "artifacts",
  });
});

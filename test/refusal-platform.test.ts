import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createProvider } from "../src/index.ts";
import type { Provider } from "../src/provider.ts";

/** One row per check the base class runs, each with the input that trips it. */
const refusals: [string, (provider: Provider) => Promise<unknown>][] = [
  ["file read offset", (p) => p.repos.readContents("o", "r", "a.md", { offset: -1 })],
  ["file read path", (p) => p.repos.readContents("o", "r", "../a.md")],
  ["template page", (p) => p.contributionTemplates.list("o", "r", "issue", { page: 0 })],
  ["template key", (p) => p.contributionTemplates.get("o", "r", "issue", "")],
  ["code search query", (p) => p.code.search(" ")],
  ["code search scope", (p) => p.code.search("x", { repo: "r" })],
  ["CI run id", (p) => p.ciRuns.listJobs("o", "r", "0")],
  ["CI job page", (p) => p.ciRuns.listJobs("o", "r", "1", { perPage: 0 })],
  ["CI job log offset", (p) => p.ciRuns.readJobLog("o", "r", "1", { offset: -1 })],
  ["commit search query", (p) => p.commits.search(" ")],
  ["commit search scope", (p) => p.commits.search("x", { repo: "r" })],
  ["commit comparison refs", (p) => p.commits.compare("o", "r", " ", "main")],
  ["commit comparison page", (p) => p.commits.compare("o", "r", "a", "b", { page: 0 })],
  ["commit patch offset", (p) => p.commits.readPatch("o", "r", "abc", { offset: -1 })],
  ["release read tag", (p) => p.releases.get("o", "r", " ")],
  ["release create tag", (p) => p.releases.create("o", "r", { tag: " " })],
  ["release update", (p) => p.releases.update("o", "r", "v1", {})],
  ["global issue search", (p) => p.issues.searchGlobal(" ")],
  ["global issue labels", (p) => p.issues.searchGlobal("x", { labels: ["a,b"] })],
  ["issue search query", (p) => p.issues.search("o", "r", " ")],
  ["issue assignees", (p) => p.issues.create("o", "r", { title: "t", body: "", assignees: [""] })],
  ["issue update", (p) => p.issues.update("o", "r", 1, {})],
  ["issue comment", (p) => p.issues.createComment("o", "r", 1, { body: " " })],
  ["global pull request search", (p) => p.pullRequests.searchGlobal(" ")],
  ["check page", (p) => p.pullRequests.listChecks("o", "r", 1, { page: 0 })],
  ["pull request search query", (p) => p.pullRequests.search("o", "r", " ")],
  ["pull request update", (p) => p.pullRequests.update("o", "r", 1, {})],
  ["merge head", (p) => p.pullRequests.merge("o", "r", 1, { headSha: " " })],
  ["pull request comment", (p) => p.pullRequests.createComment("o", "r", 1, { body: " " })],
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

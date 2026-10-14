import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createProvider } from "../src/index.ts";
import { ForgesError } from "../src/errors.ts";

const resources = [
  "repos",
  "contributionTemplates",
  "code",
  "ciRuns",
  "commits",
  "releases",
  "issues",
  "pullRequests",
  "users",
  "threads",
] as const;

/** Blank, zero and out of range values trip the shared checks before any request goes out. */
const argumentSets = [
  ["o", "r", 1, {}, {}],
  ["", "", 0, {}, {}],
  [" ", "r", 1, { page: 0 }, {}],
  ["o", "r", 1, 1, { body: " " }],
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each([
  ["github", { token: "x" }],
  ["gitlab", { token: "x" }],
  ["gitea", { token: "x", baseURL: "https://gitea.example" }],
  ["artifacts", { token: "x", accountId: "account" }],
] as const)("%s refusals", (platform, config) => {
  it("name the platform when the base class refuses the input", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const provider = await createProvider(platform, config);

    await expect(provider.issues.update("agntn", "forges", 1, {})).rejects.toMatchObject({
      status: 400,
      platform,
      message: "Issue update needs at least one change",
    });
  });

  it("name the platform on every method", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const provider = await createProvider(platform, config);
    const unsigned: string[] = [];
    let refusals = 0;

    for (const name of resources) {
      const resource = provider[name] as unknown as Record<string, (...args: unknown[]) => unknown>;
      for (const [method, call] of Object.entries(resource)) {
        for (const args of argumentSets) {
          try {
            await call(...args);
          } catch (error) {
            if (!(error instanceof ForgesError)) continue;
            refusals++;
            if (error.platform !== platform) unsigned.push(`${name}.${method}: ${error.message}`);
          }
        }
      }
    }

    expect(unsigned).toEqual([]);
    expect(refusals).toBeGreaterThan(100);
  });
});

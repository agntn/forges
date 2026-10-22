import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  AuthenticationError,
  ForgesError,
  NotFoundError,
  PermissionError,
  RateLimitError,
} from "../src/errors.ts";
import {
  cachedFetch,
  createProvider,
  fetchAllPages,
  invalidateCache,
  paginate,
  rawFetch,
  type HttpClient,
} from "../src/index.ts";

const REPO = "{ owner, repo } as its first argument";
const ISSUE = "{ owner, repo, number } as its first argument";

/** Each namespace method called the 0.5 way, positionally, with the shape it asks for now. */
const positional: [string, unknown[], string][] = [
  ["repos.get", ["o", "r"], REPO],
  ["repos.readContents", ["o", "r", "README.md"], REPO],
  ["repos.listTags", ["o", "r"], REPO],
  ["contributionTemplates.list", ["o", "r", "issue"], REPO],
  ["contributionTemplates.get", ["o", "r", "issue", "key"], REPO],
  ["ciRuns.list", ["o", "r"], REPO],
  ["ciRuns.listJobs", ["o", "r", "1"], REPO],
  ["ciRuns.readJobLog", ["o", "r", "1"], REPO],
  ["commits.list", ["o", "r"], REPO],
  ["commits.get", ["o", "r", "abc"], REPO],
  ["commits.listChecks", ["o", "r", "main"], REPO],
  ["commits.compare", ["o", "r", "v1", "main"], REPO],
  ["commits.readPatch", ["o", "r", "abc"], REPO],
  ["releases.list", ["o", "r"], REPO],
  ["releases.get", ["o", "r", "v1"], REPO],
  ["releases.create", ["o", "r", { tag: "v1" }], REPO],
  ["releases.update", ["o", "r", "v1", { name: "One" }], REPO],
  ["issues.list", ["o", "r"], REPO],
  ["issues.search", ["o", "r", "bug"], REPO],
  ["issues.get", ["o", "r", 1], ISSUE],
  ["issues.create", ["o", "r", { title: "Bug" }], REPO],
  ["issues.update", ["o", "r", 1, { state: "closed" }], ISSUE],
  ["issues.listComments", ["o", "r", 1], ISSUE],
  ["issues.getComment", ["o", "r", 1, "2"], ISSUE],
  ["issues.createComment", ["o", "r", 1, { body: "Hi" }], ISSUE],
  ["issues.listReactions", ["o", "r", 1], ISSUE],
  ["pullRequests.list", ["o", "r"], REPO],
  ["pullRequests.listFiles", ["o", "r", 1], ISSUE],
  ["pullRequests.listChecks", ["o", "r", 1], ISSUE],
  ["pullRequests.listReviews", ["o", "r", 1], ISSUE],
  ["pullRequests.getReview", ["o", "r", 1, "2"], ISSUE],
  ["pullRequests.search", ["o", "r", "bug"], REPO],
  ["pullRequests.get", ["o", "r", 1], ISSUE],
  ["pullRequests.create", ["o", "r", { title: "Fix" }], REPO],
  ["pullRequests.update", ["o", "r", 1, { title: "Fix" }], ISSUE],
  ["pullRequests.merge", ["o", "r", 1], ISSUE],
  ["pullRequests.listComments", ["o", "r", 1], ISSUE],
  ["pullRequests.getComment", ["o", "r", 1, "2"], ISSUE],
  ["pullRequests.createComment", ["o", "r", 1, { body: "Hi" }], ISSUE],
  ["pullRequests.listReactions", ["o", "r", 1], ISSUE],
  ["threads.list", ["o", "r", 1], ISSUE],
  ["threads.get", ["o", "r", 1, "t"], ISSUE],
  ["threads.reply", ["o", "r", 1, "t", { body: "Done" }], ISSUE],
  ["threads.resolve", ["o", "r", 1, "t"], ISSUE],
  ["threads.unresolve", ["o", "r", 1, "t"], ISSUE],
];

const repo = { owner: "o", repo: "r" };
const pull = { ...repo, number: 1 };

/** A bare string where the second object goes, which plain JavaScript passes silently. */
const bareSecond: [string, unknown[], string][] = [
  ["repos.readContents", [repo, "README.md"], "{ path }"],
  ["contributionTemplates.list", [repo, "issue"], "{ kind }"],
  ["contributionTemplates.get", [repo, "issue"], "{ kind, key }"],
  ["ciRuns.listJobs", [repo, "1"], "{ runId }"],
  ["ciRuns.readJobLog", [repo, "1"], "{ jobId }"],
  ["commits.get", [repo, "abc"], "{ sha }"],
  ["commits.listChecks", [repo, "main"], "{ ref }"],
  ["commits.compare", [repo, "v1"], "{ base, head }"],
  ["commits.readPatch", [repo, "abc"], "{ sha }"],
  ["releases.get", [repo, "v1"], "{ tag }"],
  ["releases.create", [repo, "v1"], "{ tag }"],
  ["releases.update", [repo, "v1"], "{ tag }"],
  ["issues.search", [repo, "bug"], "{ query }"],
  ["issues.getComment", [pull, "2"], "{ commentId }"],
  ["pullRequests.getReview", [pull, "2"], "{ reviewId }"],
  ["pullRequests.search", [repo, "bug"], "{ query }"],
  ["pullRequests.getComment", [pull, "2"], "{ commentId }"],
  ["threads.get", [pull, "t"], "{ threadId }"],
  ["threads.reply", [pull, "t"], "{ threadId }"],
  ["threads.resolve", [pull, "t"], "{ threadId }"],
  ["threads.unresolve", [pull, "t"], "{ threadId }"],
];

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Calls one `namespace.method` of a fresh provider the way untyped code would. */
async function callOldShape(path: string, args: unknown[]): Promise<unknown> {
  const provider = await createProvider("github", { token: "x" });
  const [namespace = "", method = ""] = path.split(".");
  const resource: unknown = Reflect.get(provider, namespace);
  const call: unknown = typeof resource === "object" ? Reflect.get(resource!, method) : undefined;
  if (typeof call !== "function") throw new Error(`${path} is missing`);
  return Reflect.apply(call, resource, args);
}

describe("namespace methods", () => {
  it.each(positional)("refuses the positional %s before any request", async (path, args, shape) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(callOldShape(path, args)).rejects.toThrow(new TypeError(`${path} takes ${shape}`));
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(bareSecond)("refuses a bare second argument on %s", async (path, args, shape) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(callOldShape(path, args)).rejects.toThrow(
      new TypeError(`${path} takes ${shape} as its second argument`),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("error classes", () => {
  it.each([
    [() => new ForgesError("x", 404 as never), "ForgesError takes { status, platform"],
    [() => new NotFoundError("x", "github" as never), "NotFoundError takes { platform"],
    [() => new AuthenticationError("x", "github" as never), "AuthenticationError takes { platform"],
    [() => new PermissionError("x", "github" as never), "PermissionError takes { platform"],
    [() => new RateLimitError("x", 60 as never), "RateLimitError takes { retryAfter"],
  ])("refuses a positional option %#", (construct, message) => {
    expect(construct).toThrow(TypeError);
    expect(construct).toThrow(message);
  });

  it("keeps what the options object carries", () => {
    const cause = new Error("socket");
    const limited = new RateLimitError("slow down", {
      retryAfter: 60,
      platform: "gitlab",
      originalError: cause,
    });

    expect(limited).toMatchObject({ status: 429, retryAfter: 60, platform: "gitlab" });
    expect(limited.originalError).toBe(cause);
    expect(new ForgesError("teapot", { status: 418 }).status).toBe(418);
  });
});

describe("request helpers", () => {
  const client = Object.assign(vi.fn(), { raw: vi.fn() }) as unknown as HttpClient;
  const fetcher = vi.fn();
  const url = "https://api.github.com/repos";

  it.each([
    ["cachedFetch", () => cachedFetch(client, url as never)],
    ["invalidateCache", () => invalidateCache(client, url as never)],
    ["rawFetch", () => rawFetch(client, url as never)],
    ["fetchAllPages", () => fetchAllPages(fetcher, url as never)],
    ["paginate", () => paginate(fetcher, url as never).next()],
  ])("%s refuses a bare URL", async (name, call) => {
    await expect(call()).rejects.toThrow(
      new TypeError(`${name} takes { url, ...options } as its second argument`),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});

/**
 * GitCafe provider tests
 * Runs the real `forges/gitcafe` client against a stubbed fetch, so token pages, prefixed ids and
 * refusals go through the same parsing a live response does.
 */

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { GitCafeProvider } from "../src/providers/gitcafe.ts";
import { NotFoundError } from "../src/errors.ts";

const API = "https://git.cafe/api";
const REPO = `${API}/repos/versecafe/ashlar`;
const SHA = "a8557c12366487121296e5b1584a9193a6f21d86";
const ashlar = { owner: "versecafe", repo: "ashlar" };

type Route = (url: URL, init: RequestInit) => Response | undefined;

/* versecafe/ashlar as the live API returned it on 2026-11-23, trimmed. */
const repository = {
  id: "repo_01kt3jc1ktfcf8nrrqrqs1wf0d",
  name: "ashlar",
  visibility: "public",
  owner: "versecafe",
  description: "TUI framework for SolidJS v2",
  homepage: null,
  topics: ["solid-js", "tui"],
  defaultBranch: "main",
  version: 3,
  archivedAt: null,
  createdAt: "2026-06-02T07:04:36.726Z",
  updatedAt: "2026-11-20T22:22:15.260Z",
  parent: null,
};

const signature = {
  name: "versecafe",
  email: "versecafe@users.noreply.git.cafe",
  timestamp: 1795212741,
  timezoneOffsetMinutes: -480,
};

/* The head of main on the same day, message cut to its subject. */
const head = {
  oid: SHA,
  tree: "9a3884e257fcf416ea749eebb5624096c47852b7",
  parents: ["694fa53df995bfee340dc37046d8d2f434d82ff6"],
  parentCount: 1,
  message: "release: prepare ashlar 0.5.0\n",
  summary: "release: prepare ashlar 0.5.0",
  time: 1795212741,
  author: signature,
  committer: signature,
  verification: null,
};

/* `/tree?path=scripts`, two of its six rows. */
const scripts = {
  oid: SHA,
  items: [
    { name: "build.ts", path: "scripts/build.ts", oid: "27ca52d", mode: 33188, kind: "blob" },
    { name: "fixtures", path: "scripts/fixtures", oid: "31cdfbf", mode: 16384, kind: "tree" },
  ],
  next: null,
};

const license = {
  commit: SHA,
  oid: "d0f913e2923882d50ff896b29a22abe96ff83338",
  path: "LICENSE",
  size: 41,
  binary: false,
  content: "MIT License\n\nCopyright (c) 2026 versecafe",
};

/* One `/actions/runs` row in the shape the OpenAPI schema gives it. */
function actionsRun(state: Readonly<{ status: string; conclusion: string | null }>) {
  return {
    id: "run_01m7xg9d",
    runNumber: 7,
    attempt: 1,
    rerunOf: null,
    workflowPath: ".github/workflows/test.yml",
    workflowName: "test",
    event: "push",
    ref: "refs/heads/main",
    headOid: SHA,
    ...state,
    cancelRequested: false,
    actor: null,
    diagnostics: [],
    createdAt: "2026-11-20T22:12:31.859Z",
    startedAt: null,
    completedAt: null,
  };
}

/* What `/blob` answers for a directory. */
const wrongKind = {
  type: "about:blank",
  title: "Git source request failed",
  status: 400,
  code: "invalid",
};

function serve(...routes: Route[]) {
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    return Response.json(
      { title: "Not found", status: 404, detail: "The requested resource was not found." },
      { status: 404 },
    );
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function at(path: string, body: (url: URL) => unknown, status = 200): Route {
  return (url) =>
    url.pathname === new URL(path).pathname ? Response.json(body(url), { status }) : undefined;
}

function urls(fetch: ReturnType<typeof serve>): string[] {
  return fetch.mock.calls.map(([input]) =>
    String(input instanceof Request ? input.url : input).replace(API, ""),
  );
}

function provider(): GitCafeProvider {
  return new GitCafeProvider({ token: "gct_test" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitCafeProvider repositories", () => {
  it("reads a repository from the bare git.cafe API", async () => {
    const fetch = serve(at(`${REPO}/`, () => repository));

    const read = await provider().repos.get(ashlar);

    expect(read).toMatchObject({
      id: "repo_01kt3jc1ktfcf8nrrqrqs1wf0d",
      fullName: "versecafe/ashlar",
      defaultBranch: "main",
      private: false,
      url: "https://git.cafe/versecafe/ashlar",
      cloneUrl: "https://git.cafe/versecafe/ashlar.git",
    });
    expect(urls(fetch)).toEqual(["/repos/versecafe/ashlar/"]);
  });

  it("adds /api to a bare instance root", async () => {
    const fetch = serve(
      at("https://cafe.example.test/api/repos/versecafe/ashlar/", () => repository),
    );

    await new GitCafeProvider({ baseURL: "https://cafe.example.test", token: "" }).repos.get(
      ashlar,
    );

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://cafe.example.test/api/repos/versecafe/ashlar/",
    );
  });

  it("refuses a page of more than 50 repositories before any request", async () => {
    const fetch = serve();

    await expect(provider().repos.list("versecafe", { perPage: 51 })).rejects.toMatchObject({
      status: 400,
      message: "GitCafe lists 50 repositories a page at most",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("GitCafeProvider commits", () => {
  it("passes a ref to the commit log", async () => {
    const fetch = serve(at(`${REPO}/commits`, () => ({ items: [head], next: "IjY5NGZh" })));

    const page = await provider().commits.list(ashlar, { ref: SHA, perPage: 1 });

    expect(page.items.map((commit) => commit.sha)).toEqual([SHA]);
    expect(page.nextCursor).toBeTypeOf("string");
    expect(urls(fetch)).toEqual([`/repos/versecafe/ashlar/commits?oid=${SHA}&limit=1`]);
  });

  it.each([
    [{ since: "2026-01-01T00:00:00Z" }, "since"],
    [{ until: "2026-01-01T00:00:00Z" }, "until"],
    [{ path: "src" }, "path"],
    [{ path: "src", since: "2026-01-01T00:00:00Z" }, "path, since"],
  ])("answers 501 for %o, which the log would ignore", async (options, named) => {
    const fetch = serve();

    await expect(provider().commits.list(ashlar, options)).rejects.toMatchObject({
      status: 501,
      platform: "gitcafe",
      message: `GitCafe filters commits by ref only. Drop ${named}`,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("GitCafeProvider CI runs", () => {
  it("lists a branch's runs", async () => {
    const fetch = serve(at(`${REPO}/actions/runs`, () => ({ items: [], next: null })));

    const page = await provider().ciRuns.list(ashlar, { branch: "main" });

    expect(page.items).toEqual([]);
    expect(urls(fetch)).toEqual(["/repos/versecafe/ashlar/actions/runs?branch=main&limit=30"]);
  });

  it("keeps GitCafe's own conclusion on a finished run", async () => {
    serve(
      at(`${REPO}/actions/runs`, () => ({
        items: [
          actionsRun({ status: "completed", conclusion: "cancelled" }),
          actionsRun({ status: "completed", conclusion: "skipped" }),
          actionsRun({ status: "completed", conclusion: "timed_out" }),
          actionsRun({ status: "running", conclusion: null }),
        ],
        next: null,
      })),
    );

    const page = await provider().ciRuns.list(ashlar);

    expect(page.items.map(({ status, conclusion }) => [status, conclusion])).toEqual([
      ["completed", "cancelled"],
      ["completed", "skipped"],
      ["completed", "timed_out"],
      ["in_progress", null],
    ]);
  });

  it("answers 501 for a workflow filter, which the run list would ignore", async () => {
    const fetch = serve();

    await expect(provider().ciRuns.list(ashlar, { workflow: "test.yml" })).rejects.toMatchObject({
      status: 501,
      message: "GitCafe filters CI runs by branch only. Drop workflow",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("GitCafeProvider contents", () => {
  it("reads a file at the commit its ref resolves to", async () => {
    const fetch = serve(
      at(`${REPO}/commit`, () => head),
      at(`${REPO}/blob`, () => license),
    );

    const file = await provider().repos.readContents(ashlar, { path: "LICENSE", ref: "main" });

    expect(file).toMatchObject({
      type: "file",
      path: "LICENSE",
      sha: SHA,
      content: "MIT License\n\nCopyright (c) 2026 versecafe",
      truncated: false,
    });
    expect(urls(fetch)).toEqual([
      "/repos/versecafe/ashlar/commit?ref=refs%2Fheads%2Fmain",
      `/repos/versecafe/ashlar/blob?oid=${SHA}&path=LICENSE`,
    ]);
  });

  it("fetches the raw bytes when the blob comes without text", async () => {
    const fetch = serve(
      at(`${REPO}/blob`, () => ({
        ...license,
        path: "logo.png",
        size: 4,
        binary: true,
        content: null,
      })),
      (url) =>
        url.pathname === "/api/repos/versecafe/ashlar/raw"
          ? new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x00]))
          : undefined,
    );

    const file = await provider().repos.readContents(ashlar, { path: "logo.png", ref: SHA });

    expect(file).toMatchObject({ type: "file", sha: SHA, binary: true, content: "", size: 4 });
    expect(urls(fetch)).toEqual([
      `/repos/versecafe/ashlar/blob?oid=${SHA}&path=logo.png`,
      `/repos/versecafe/ashlar/raw?oid=${SHA}&path=logo.png`,
    ]);
  });

  it("lists a directory when /blob calls the path one", async () => {
    const fetch = serve(
      at(`${REPO}/blob`, () => wrongKind, 400),
      at(`${REPO}/tree`, () => scripts),
    );

    const listing = await provider().repos.readContents(ashlar, { path: "scripts", ref: SHA });

    expect(listing).toEqual({
      type: "directory",
      path: "scripts",
      sha: SHA,
      entries: [
        { name: "build.ts", path: "scripts/build.ts", type: "file", size: null },
        { name: "fixtures", path: "scripts/fixtures", type: "directory", size: null },
      ],
      entriesComplete: true,
    });
    expect(urls(fetch)).toEqual([
      `/repos/versecafe/ashlar/blob?oid=${SHA}&path=scripts`,
      `/repos/versecafe/ashlar/tree?oid=${SHA}&path=scripts&limit=200`,
    ]);
  });

  it("reads the root as a directory without asking /blob", async () => {
    const fetch = serve(
      at(`${REPO}/commit`, () => head),
      at(`${REPO}/tree`, () => ({ ...scripts, items: [] })),
    );

    await provider().repos.readContents(ashlar, { path: "" });

    expect(urls(fetch)).toEqual([
      "/repos/versecafe/ashlar/commit?ref=HEAD",
      `/repos/versecafe/ashlar/tree?oid=${SHA}&limit=200`,
    ]);
  });

  it("follows next tokens and calls a listing incomplete past ten pages", async () => {
    const fetch = serve(at(`${REPO}/tree`, () => ({ ...scripts, next: "more" })));

    const listing = await provider().repos.readContents(ashlar, { path: "", ref: SHA });

    expect(listing).toMatchObject({ type: "directory", entriesComplete: false });
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(urls(fetch)[1]).toBe(`/repos/versecafe/ashlar/tree?oid=${SHA}&limit=200&after=more`);
  });

  it("keeps a missing path a 404", async () => {
    serve(at(`${REPO}/blob`, () => ({ status: 404, code: "not-found" }), 404));

    await expect(
      provider().repos.readContents(ashlar, { path: "nope.txt", ref: SHA }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not take any 400 for a directory", async () => {
    const fetch = serve(at(`${REPO}/blob`, () => ({ status: 400, code: "validation" }), 400));

    await expect(
      provider().repos.readContents(ashlar, { path: "x", ref: SHA }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

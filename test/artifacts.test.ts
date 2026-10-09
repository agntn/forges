/**
 * Cloudflare Artifacts provider tests
 * Runs the real HTTP client against a stubbed fetch, so envelopes, raw file bytes
 * and envelope errors go through the same parsing a live response does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createProvider } from "../src/index.ts";
import { ArtifactsProvider } from "../src/providers/artifacts.ts";
import { AuthenticationError, ForgesError, NotFoundError } from "../src/errors.ts";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("@agntn/credentials/cloudflare", () => ({ resolve: mocks.resolve }));

import { CredentialsError } from "@agntn/credentials";

/* A credential failure renamed the way a subclass would be, so only instanceof recognises it. */
function missingAccount(): CredentialsError {
  return Object.defineProperty(
    new CredentialsError("cloudflare", "Set AGNTN_CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID"),
    "name",
    { value: "MissingAccountError" },
  );
}

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const ACCOUNT_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/artifacts`;
const REPO_URL = `${ACCOUNT_URL}/namespaces/tools/repos/notes`;
const HEAD = "1111111111111111111111111111111111111111";
const PARENT = "2222222222222222222222222222222222222222";
const ROOT_TREE = "3333333333333333333333333333333333333333";
const DOCS_TREE = "4444444444444444444444444444444444444444";

/* Fixtures in the shape the live API returned on 2026-10-07. */

function repository(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1b2c3d4e5f6g7h8",
    name: "notes",
    description: null,
    default_branch: "main",
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:01.000Z",
    last_push_at: null,
    source: null,
    read_only: false,
    remote: `https://${ACCOUNT}.artifacts.cloudflare.net/git/tools/notes.git`,
    ...overrides,
  };
}

function commit(hash: string, parents: string[], overrides: Record<string, unknown> = {}) {
  return {
    hash,
    treeHash: ROOT_TREE,
    message: "Write the notes down",
    author: { name: "Ada", email: "ada@example.com" },
    committer: { name: "Ada", email: "ada@example.com" },
    parents,
    authoredAt: 1_790_000_000,
    committedAt: 1_790_000_060,
    ...overrides,
  };
}

const rootTree = [
  { name: "README.md", mode: "100644", hash: "5".repeat(40), type: "blob" },
  { name: "docs", mode: "40000", hash: DOCS_TREE, type: "tree" },
  { name: "run.sh", mode: "100755", hash: "6".repeat(40), type: "exec" },
  { name: "vendor", mode: "160000", hash: "7".repeat(40), type: "gitlink" },
];

const docsTree = [{ name: "guide.md", mode: "100644", hash: "8".repeat(40), type: "blob" }];

function envelope(result: unknown, extra: Record<string, unknown> = {}): Response {
  return Response.json({ result, success: true, errors: [], messages: [], ...extra });
}

function failure(status: number, code: number, message: string): Response {
  return Response.json(
    { result: null, success: false, errors: [{ code, message }], messages: [] },
    { status },
  );
}

function bytes(text: string): Response {
  return new Response(new TextEncoder().encode(text), {
    headers: { "content-type": "application/octet-stream" },
  });
}

type Route = (url: URL, init: RequestInit) => Response | undefined;

/** Answer each request from the first route that knows it, and record what was sent. */
function serve(...routes: Route[]) {
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    return failure(404, 10200, `No fixture for ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function at(path: string, response: () => Response): Route {
  return (url) => (url.pathname === new URL(path).pathname ? response() : undefined);
}

function sent(fetch: ReturnType<typeof serve>, index = 0): { url: URL; headers: Headers } {
  const call = fetch.mock.calls[index];
  return { url: new URL(String(call?.[0])), headers: new Headers(call?.[1]?.headers) };
}

function provider(): ArtifactsProvider {
  return new ArtifactsProvider({ token: "cf-token", accountId: ACCOUNT });
}

beforeEach(() => {
  mocks.resolve.mockImplementation(async (options: { token?: string; accountId?: string }) => ({
    token: options.token ?? "cf-token",
    accountId: options.accountId ?? ACCOUNT,
    source: options.token === undefined ? "env" : "explicit",
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createProvider", () => {
  it("loads the artifacts provider and signs with a bearer token", async () => {
    const fetch = serve(at(REPO_URL, () => envelope(repository())));
    const artifacts = await createProvider("artifacts", { token: "cf-token", accountId: ACCOUNT });

    expect(artifacts).toBeInstanceOf(ArtifactsProvider);
    await artifacts.repos.get("tools", "notes");
    const { url, headers } = sent(fetch);
    expect(url.href).toBe(REPO_URL);
    expect(headers.get("authorization")).toBe("Bearer cf-token");
  });

  it("keeps the account the credential chain settled on", async () => {
    mocks.resolve.mockResolvedValue({ token: "session", accountId: ACCOUNT, source: "cli" });
    const fetch = serve(at(REPO_URL, () => envelope(repository())));

    const artifacts = await createProvider("artifacts");
    await artifacts.repos.get("tools", "notes");

    expect(mocks.resolve).toHaveBeenCalledWith({ token: undefined, accountId: undefined });
    expect(mocks.resolve).toHaveBeenLastCalledWith({
      token: undefined,
      accountId: ACCOUNT,
      refresh: false,
    });
    expect(sent(fetch).headers.get("authorization")).toBe("Bearer session");
  });

  it("answers a missing credential with AuthenticationError before loading anything", async () => {
    mocks.resolve.mockRejectedValue(missingAccount());

    const error = await createProvider("artifacts").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).message).toBe(
      "No Cloudflare credentials for artifacts: Set AGNTN_CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID",
    );
  });
});

describe("credentials", () => {
  it("fetches a refused cf session token again and retries once", async () => {
    mocks.resolve.mockImplementation(async (options: { refresh?: boolean }) => ({
      token: options.refresh ? "fresh" : "stale",
      accountId: ACCOUNT,
      source: "cli",
    }));
    const fetch = serve((url, init) =>
      url.pathname === new URL(REPO_URL).pathname
        ? new Headers(init.headers).get("authorization") === "Bearer fresh"
          ? envelope(repository())
          : failure(401, 10000, "Authentication error")
        : undefined,
    );

    const repo = await new ArtifactsProvider({}).repos.get("tools", "notes");

    expect(repo.name).toBe("notes");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.resolve).toHaveBeenCalledWith({
      token: undefined,
      accountId: undefined,
      refresh: true,
    });
  });

  it("does not retry a refused token the caller handed over", async () => {
    const fetch = serve(at(REPO_URL, () => failure(401, 10000, "Authentication error")));

    const error = await provider()
      .repos.get("tools", "notes")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as Error).message).toContain("Authentication error");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("repos", () => {
  it("maps a repository with the namespace as owner", async () => {
    serve(at(REPO_URL, () => envelope(repository({ description: "Field notes" }))));

    expect(await provider().repos.get("tools", "notes")).toEqual({
      id: "a1b2c3d4e5f6g7h8",
      name: "notes",
      fullName: "tools/notes",
      description: "Field notes",
      private: true,
      defaultBranch: "main",
      url: REPO_URL,
      cloneUrl: `https://${ACCOUNT}.artifacts.cloudflare.net/git/tools/notes.git`,
      isFork: false,
      parent: null,
      viewerPermission: null,
      merge: null,
      owner: { login: "tools", avatarUrl: "" },
    });
  });

  it("points a fork at the repository it came from", async () => {
    serve(at(REPO_URL, () => envelope(repository({ source: "artifacts:archive/notes" }))));

    const repo = await provider().repos.get("tools", "notes");

    expect(repo.isFork).toBe(true);
    expect(repo.parent).toEqual({
      fullName: "archive/notes",
      url: `${ACCOUNT_URL}/namespaces/archive/repos/notes`,
    });
  });

  it("keeps the envelope reason on a missing repository", async () => {
    serve(at(REPO_URL, () => failure(404, 10200, "Repository not found")));

    const error = await provider()
      .repos.get("tools", "notes")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as Error).message).toContain("Repository not found");
  });

  it("walks the cursor up to the requested page and one row past it", async () => {
    const names = ["a", "b", "c", "d", "e"];
    const fetch = serve((url) => {
      if (!url.pathname.endsWith("/namespaces/tools/repos")) return undefined;
      const start = Number(url.searchParams.get("cursor") ?? "0");
      const limit = Number(url.searchParams.get("limit"));
      const chunk = names.slice(start, start + limit).map((name) => repository({ name }));
      const end = start + chunk.length;
      return envelope(chunk, {
        result_info:
          end < names.length
            ? { cursor: String(end), per_page: limit, count: chunk.length }
            : { page: 1, per_page: limit, total_pages: 1, count: chunk.length },
      });
    });

    const page = await provider().repos.list("tools", { page: 2, perPage: 2 });

    expect(page.items.map((repo) => repo.name)).toEqual(["c", "d"]);
    expect(page.hasNextPage).toBe(true);
    expect(page.nextPage).toBe(3);
    expect(sent(fetch).url.searchParams.get("limit")).toBe("5");
  });

  it("ends the list when the cursor leads to an empty page", async () => {
    serve((url) => {
      if (!url.pathname.endsWith("/namespaces/tools/repos")) return undefined;
      return url.searchParams.has("cursor")
        ? envelope([], { result_info: { page: 1, per_page: 3, total_pages: 1, count: 0 } })
        : envelope([repository({ name: "a" }), repository({ name: "b" })], {
            result_info: { cursor: "next", per_page: 3, count: 2 },
          });
    });

    const page = await provider().repos.list("tools", { perPage: 2 });

    expect(page.items.map((repo) => repo.name)).toEqual(["a", "b"]);
    expect(page.hasNextPage).toBe(false);
  });

  it("stops at an empty cursor instead of starting over from the first page", async () => {
    const fetch = serve(
      at(`${ACCOUNT_URL}/namespaces/tools/repos`, () =>
        envelope([repository({ name: "a" })], {
          result_info: { cursor: "", per_page: 3, count: 1 },
        }),
      ),
    );

    const page = await provider().repos.list("tools", { perPage: 2 });

    expect(page.items.map((repo) => repo.name)).toEqual(["a"]);
    expect(page.hasNextPage).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("asks for at most 200 repositories a request", async () => {
    const fetch = serve(at(`${ACCOUNT_URL}/namespaces/tools/repos`, () => envelope([])));

    await provider().repos.list("tools", { page: 3, perPage: 100 });

    expect(sent(fetch).url.searchParams.get("limit")).toBe("200");
  });
});

describe("repos.readContents", () => {
  const atHead = at(`${REPO_URL}/log`, () => envelope([commit(HEAD, [PARENT])]));
  const trees: Route = (url) => {
    if (url.pathname.endsWith(`/tree/${ROOT_TREE}`)) return envelope(rootTree);
    if (url.pathname.endsWith(`/tree/${DOCS_TREE}`)) return envelope(docsTree);
    return undefined;
  };
  const files: Route = (url) => {
    if (!url.pathname.endsWith("/file")) return undefined;
    return url.searchParams.get("path") === "README.md"
      ? bytes("# Notes\n")
      : failure(404, 10200, "File not found");
  };

  it("reads a file at the commit HEAD resolves to", async () => {
    const fetch = serve(atHead, files);

    const file = await provider().repos.readContents("tools", "notes", "README.md");

    expect(file).toEqual({
      type: "file",
      path: "README.md",
      sha: HEAD,
      size: 8,
      binary: false,
      content: "# Notes\n",
      offset: 0,
      nextOffset: null,
      truncated: false,
    });
    expect(sent(fetch, 0).url.searchParams.has("ref")).toBe(false);
    expect(sent(fetch, 0).url.searchParams.get("limit")).toBe("1");
    expect(sent(fetch, 1).url.searchParams.get("ref")).toBe(HEAD);
  });

  it("lists a directory the file route refused", async () => {
    serve(atHead, files, trees);

    const contents = await provider().repos.readContents("tools", "notes", "docs");

    expect(contents).toEqual({
      type: "directory",
      path: "docs",
      sha: HEAD,
      entries: [{ name: "guide.md", path: "docs/guide.md", type: "file", size: null }],
      entriesComplete: true,
    });
  });

  it("lists the root with every entry type mapped", async () => {
    const fetch = serve(atHead, trees);

    const contents = await provider().repos.readContents("tools", "notes", "");

    expect(contents.type === "directory" && contents.entries.map((entry) => entry.type)).toEqual([
      "file",
      "directory",
      "file",
      "submodule",
    ]);
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/file"))).toBe(false);
  });

  it("answers a missing path with NotFoundError", async () => {
    serve(atHead, files, trees);

    await expect(
      provider().repos.readContents("tools", "notes", "docs/missing.md"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("answers a path through a file with NotFoundError, not a type error", async () => {
    serve(atHead, files, trees);

    await expect(
      provider().repos.readContents("tools", "notes", "run.sh/inner"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a submodule path instead of listing it", async () => {
    serve(atHead, files, trees);

    const error = await provider()
      .repos.readContents("tools", "notes", "vendor")
      .catch((caught: unknown) => caught);

    expect((error as ForgesError).status).toBe(422);
  });

  it("keeps the envelope reason when the file route refuses a read", async () => {
    serve(
      atHead,
      at(`${REPO_URL}/file`, () => failure(400, 10100, "Invalid input: path too long")),
    );

    const error = await provider()
      .repos.readContents("tools", "notes", "README.md")
      .catch((caught: unknown) => caught);

    expect((error as ForgesError).status).toBe(400);
    expect((error as Error).message).toContain("Invalid input: path too long");
  });

  it("leaves an explicit HEAD out of the log, which reads it as an unknown ref", async () => {
    const fetch = serve(atHead, files);

    await provider().repos.readContents("tools", "notes", "README.md", { ref: "HEAD" });

    expect(sent(fetch, 0).url.searchParams.has("ref")).toBe(false);
  });

  it("says an empty repository has no commits yet", async () => {
    serve(at(`${REPO_URL}/log`, () => envelope([])));

    await expect(provider().repos.readContents("tools", "notes", "README.md")).rejects.toThrow(
      "The repository has no commits yet",
    );
  });

  it("reads a full SHA as a commit without the log", async () => {
    const fetch = serve(
      at(`${REPO_URL}/commit/${HEAD}`, () => envelope(commit(HEAD, [PARENT]))),
      files,
    );

    await provider().repos.readContents("tools", "notes", "README.md", { ref: HEAD });

    expect(fetch.mock.calls.some(([url]) => String(url).includes("/log"))).toBe(false);
  });

  it("answers an unknown ref with NotFoundError, since the log returns an empty list", async () => {
    serve(at(`${REPO_URL}/log`, () => envelope([])));

    await expect(
      provider().repos.readContents("tools", "notes", "README.md", { ref: "nope" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("commits", () => {
  it("lists one page by offset and reads one row past it", async () => {
    const fetch = serve(
      at(`${REPO_URL}/log`, () =>
        envelope([commit(HEAD, [PARENT]), commit(PARENT, []), commit("9".repeat(40), [])]),
      ),
    );

    const page = await provider().commits.list("tools", "notes", {
      ref: "main",
      page: 2,
      perPage: 2,
    });

    const { url } = sent(fetch);
    expect(url.searchParams.get("offset")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("3");
    expect(url.searchParams.get("ref")).toBe("main");
    expect(page.hasNextPage).toBe(true);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toEqual({
      sha: HEAD,
      message: "Write the notes down",
      author: { name: "Ada", email: "ada@example.com", date: "2026-09-21T14:13:20.000Z" },
      committer: { name: "Ada", email: "ada@example.com", date: "2026-09-21T14:14:20.000Z" },
      parents: [PARENT],
      url: `${REPO_URL}/commit/${HEAD}`,
    });
  });

  it("answers an unknown ref with NotFoundError", async () => {
    serve(at(`${REPO_URL}/log`, () => envelope([])));

    await expect(provider().commits.list("tools", "notes", { ref: "nope" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("gives an empty repository an empty page", async () => {
    serve(at(`${REPO_URL}/log`, () => envelope([])));

    expect(await provider().commits.list("tools", "notes")).toEqual({
      items: [],
      hasNextPage: false,
      nextPage: undefined,
    });
  });

  it("refuses filters the log cannot apply before any request", async () => {
    const fetch = serve();

    const error = await provider()
      .commits.list("tools", "notes", { path: "README.md" })
      .catch((caught: unknown) => caught);

    expect((error as ForgesError).status).toBe(501);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves a date empty instead of failing on a time the API left out", async () => {
    serve(
      at(`${REPO_URL}/commit/${HEAD}`, () =>
        envelope(commit(HEAD, [PARENT], { authoredAt: undefined })),
      ),
    );

    const read = await provider().commits.get("tools", "notes", HEAD);

    expect(read.author.date).toBe("");
    expect(read.committer.date).toBe("2026-09-21T14:14:20.000Z");
  });

  it("reads a commit by SHA and leaves its files unknown", async () => {
    serve(at(`${REPO_URL}/commit/${HEAD}`, () => envelope(commit(HEAD, [PARENT]))));

    const read = await provider().commits.get("tools", "notes", HEAD);

    expect(read.sha).toBe(HEAD);
    expect(read.files).toEqual([]);
    expect(read.filesComplete).toBeNull();
  });

  it("resolves a branch through the log", async () => {
    const fetch = serve(at(`${REPO_URL}/log`, () => envelope([commit(HEAD, [PARENT])])));

    const read = await provider().commits.get("tools", "notes", "main");

    expect(read.sha).toBe(HEAD);
    expect(sent(fetch).url.searchParams.get("ref")).toBe("main");
  });
});

describe("unsupported resources", () => {
  it.each([
    ["issues", (artifacts: ArtifactsProvider) => artifacts.issues.list("tools", "notes")],
    [
      "pull requests",
      (artifacts: ArtifactsProvider) => artifacts.pullRequests.get("tools", "notes", 1),
    ],
    ["users", (artifacts: ArtifactsProvider) => artifacts.users.authenticated()],
    [
      "review threads",
      (artifacts: ArtifactsProvider) => artifacts.threads.list("tools", "notes", 1),
    ],
    ["releases", (artifacts: ArtifactsProvider) => artifacts.releases.list("tools", "notes")],
    ["CI runs", (artifacts: ArtifactsProvider) => artifacts.ciRuns.list("tools", "notes")],
  ])("answers %s with 501 and no request", async (_name, call) => {
    const fetch = serve();

    const error = await call(provider()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForgesError);
    expect((error as ForgesError).status).toBe(501);
    expect(fetch).not.toHaveBeenCalled();
  });
});

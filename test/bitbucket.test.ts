/**
 * Bitbucket Cloud provider tests
 * Runs the real `forges/bitbucket` client against a stubbed fetch, so pages, auth headers and
 * refusals go through the same parsing a live response does.
 */

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createProvider } from "../src/index.ts";
import { BitbucketProvider } from "../src/providers/bitbucket.ts";
import { ForgesError, NotFoundError } from "../src/errors.ts";

const API = "https://api.bitbucket.org/2.0";
const REPO = `${API}/repositories/atlassian/atlassian-connect-express`;
const PULL = `${REPO}/pullrequests/527`;
const SHA = "9c5c85803bfbd3131f0606cdf3c99e16c4c26f88";
const ace = { owner: "atlassian", repo: "atlassian-connect-express" };
const pull = { ...ace, number: 527 };

function link(id: number): { html: { href: string } } {
  return {
    html: {
      href: `https://bitbucket.org/atlassian/atlassian-connect-express/pull-requests/527/_/diff#comment-${id}`,
    },
  };
}

function inline(path: string, to: number | null, from: number | null = null) {
  return { from, to, path, start_from: null, start_to: null };
}

/* Comments of atlassian/atlassian-connect-express#527 as the live API returned them on 2026-11-15, bodies cut. */
const comments = [
  {
    id: 637654717,
    created_on: "2025-05-27T00:27:08Z",
    updated_on: "2025-05-27T00:27:08Z",
    deleted: false,
    content: { raw: "The `params` key in the GraphQL request " },
    user: { nickname: "Autoreview" },
    inline: inline("lib/internal/forge-user-token-handler.js", 56),
    links: link(637654717),
  },
  {
    id: 637654721,
    created_on: "2025-05-27T00:27:09Z",
    updated_on: "2025-12-04T03:03:47Z",
    deleted: false,
    content: { raw: "The error thrown at line 106 should use " },
    user: { nickname: "Autoreview" },
    inline: inline("lib/internal/forge-user-token-handler.js", 110),
    resolution: {},
    links: link(637654721),
  },
  {
    id: 637654724,
    created_on: "2025-05-27T00:27:10Z",
    updated_on: "2025-05-27T00:27:10Z",
    deleted: false,
    content: { raw: "##### Please use the feedback collector " },
    user: { nickname: "Autoreview" },
    links: link(637654724),
  },
  {
    id: 671727071,
    created_on: "2025-08-19T06:33:02Z",
    updated_on: "2025-12-04T01:02:41Z",
    deleted: false,
    content: { raw: "I wonder if working with ContextARI is c" },
    user: { nickname: "Ilnar Taichinov" },
    inline: inline("README.md", 723),
    resolution: {},
    links: link(671727071),
  },
  {
    id: 672130472,
    created_on: "2025-08-20T00:03:48Z",
    updated_on: "2025-08-20T00:03:48Z",
    deleted: false,
    content: { raw: "This is a good point, I think it might n" },
    user: { nickname: "Nicholas Berridge-Argent" },
    parent: { id: 671727071 },
    inline: inline("README.md", 723),
    links: link(672130472),
  },
  {
    id: 672134034,
    created_on: "2025-08-20T00:22:34Z",
    updated_on: "2025-08-20T00:22:34Z",
    deleted: false,
    content: { raw: "an example in the README would also be g" },
    user: { nickname: "Serena Wang" },
    parent: { id: 671727071 },
    inline: inline("README.md", 723),
    links: link(672134034),
  },
  {
    id: 672135002,
    created_on: "2025-08-20T00:27:56Z",
    updated_on: "2025-08-20T00:27:56Z",
    deleted: false,
    content: { raw: "nit\n\n`ForgeSettings` has installationId " },
    user: { nickname: "Serena Wang" },
    inline: inline("README.md", 723),
    links: link(672135002),
  },
  {
    id: 672136036,
    created_on: "2025-08-20T00:32:36Z",
    updated_on: "2025-08-20T00:32:36Z",
    deleted: false,
    content: { raw: "do u now when will this feature be relea" },
    user: { nickname: "Serena Wang" },
    links: link(672136036),
  },
  {
    id: 672168187,
    created_on: "2025-08-20T03:08:30Z",
    updated_on: "2025-08-20T03:08:30Z",
    deleted: false,
    content: { raw: "The underlying feature is already releas" },
    user: { nickname: "Nicholas Berridge-Argent" },
    parent: { id: 672136036 },
    links: link(672168187),
  },
  {
    id: 672168832,
    created_on: "2025-08-20T03:11:52Z",
    updated_on: "2025-08-20T03:11:52Z",
    deleted: false,
    content: { raw: "I did think about this, but then this ti" },
    user: { nickname: "Nicholas Berridge-Argent" },
    parent: { id: 672135002 },
    inline: inline("README.md", 723),
    links: link(672168832),
  },
  {
    id: 2001436760,
    created_on: "2025-12-04T23:50:14Z",
    updated_on: "2025-12-04T23:50:22Z",
    deleted: false,
    content: { raw: "nit: would be good to have tests for the" },
    user: { nickname: "Serena Wang" },
    inline: inline("test/forge-end-to-end.test.js", null, 4),
    links: link(2001436760),
  },
];

/** A Bitbucket error body, the shape every refusal the live API sent had. */
function refusal(status: number, message: string): Response {
  return Response.json({ type: "error", error: { message } }, { status });
}

type Route = (url: URL, init: RequestInit) => Response | undefined;

/** Answer each request from the first route that knows it, and record what was sent. */
function serve(...routes: Route[]) {
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const request = input instanceof Request ? input : undefined;
    const merged: RequestInit = { method: request?.method, headers: request?.headers, ...init };
    for (const route of routes) {
      const response = route(url, merged);
      if (response) return response;
    }
    return refusal(404, `No fixture for ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function at(path: string, response: (url: URL, init: RequestInit) => Response): Route {
  return (url, init) => (url.pathname === new URL(path).pathname ? response(url, init) : undefined);
}

function sent(fetch: ReturnType<typeof serve>, index = 0) {
  const call = fetch.mock.calls[index];
  const input = call?.[0];
  const request = input instanceof Request ? input : undefined;
  return {
    url: new URL(String(request?.url ?? input)),
    method: (call?.[1]?.method ?? request?.method ?? "GET").toUpperCase(),
    headers: new Headers(call?.[1]?.headers ?? request?.headers),
    body: call?.[1]?.body,
  };
}

/** Every comment, the way `/comments` pages them: everything on one page at pagelen 100. */
const allComments = at(`${PULL}/comments`, () =>
  Response.json({ values: comments, pagelen: 100, size: comments.length, page: 1 }),
);

function provider(config: { token?: string; username?: string } = {}): BitbucketProvider {
  return new BitbucketProvider({ token: "bb-token", ...config });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createProvider", () => {
  it("loads the bitbucket provider and sends an access token as a bearer", async () => {
    const fetch = serve(
      at(REPO, () => Response.json({ full_name: "atlassian/atlassian-connect-express" })),
    );
    const bitbucket = await createProvider("bitbucket", { token: "bb-token" });

    expect(bitbucket).toBeInstanceOf(BitbucketProvider);
    await bitbucket.repos.get(ace).catch(() => undefined);
    expect(sent(fetch).headers.get("authorization")).toBe("Bearer bb-token");
  });

  it("sends an API token with its email as basic auth", async () => {
    const fetch = serve(
      at(REPO, () => Response.json({ full_name: "atlassian/atlassian-connect-express" })),
    );
    const bitbucket = await createProvider("bitbucket", {
      token: "ATATT-api",
      username: "ada@example.com",
    });

    await bitbucket.repos.get(ace).catch(() => undefined);
    expect(sent(fetch).headers.get("authorization")).toBe(
      `Basic ${Buffer.from("ada@example.com:ATATT-api").toString("base64")}`,
    );
  });

  it("reads anonymously with an empty token", async () => {
    const fetch = serve(
      at(REPO, () => Response.json({ full_name: "atlassian/atlassian-connect-express" })),
    );

    await provider({ token: "" })
      .repos.get(ace)
      .catch(() => undefined);
    expect(sent(fetch).headers.has("authorization")).toBe(false);
  });
});

describe("review threads", () => {
  it("groups inline comments under the comment that opened them, oldest first", async () => {
    serve(allComments);

    const { items } = await provider().threads.list(pull);

    expect(items.map((thread) => thread.id)).toEqual([
      "637654717",
      "637654721",
      "671727071",
      "672135002",
      "2001436760",
    ]);
    expect(items[2]).toEqual({
      id: "671727071",
      isResolved: true,
      isOutdated: false,
      path: "README.md",
      line: 723,
      startLine: null,
      comments: [
        expect.objectContaining({ id: "671727071", author: { login: "Ilnar Taichinov" } }),
        expect.objectContaining({
          id: "672130472",
          body: "This is a good point, I think it might n",
        }),
        expect.objectContaining({ id: "672134034" }),
      ],
    });
  });

  it("follows a reply to a reply back to the comment that opened the thread", async () => {
    serve(allComments);

    const thread = await provider().threads.get(pull, { threadId: "672135002" });

    expect(thread.comments.map((comment) => comment.id)).toEqual(["672135002", "672168832"]);
    expect(thread.isResolved).toBe(false);
  });

  it("takes the old side's line when the comment sits on a removed line", async () => {
    serve(allComments);

    const thread = await provider().threads.get(pull, { threadId: "2001436760" });

    expect(thread).toMatchObject({ path: "test/forge-end-to-end.test.js", line: 4 });
  });

  it("filters by resolution", async () => {
    serve(allComments);

    const resolved = await provider().threads.list(pull, { state: "resolved" });
    const open = await provider().threads.list(pull, { state: "unresolved" });

    expect(resolved.items.map((thread) => thread.id)).toEqual(["637654721", "671727071"]);
    expect(open.items).toHaveLength(3);
  });

  it("leaves conversation replies out of every thread", async () => {
    serve(allComments);

    const { items } = await provider().threads.list(pull);

    const ids = items.flatMap((thread) => thread.comments.map((comment) => comment.id));
    expect(ids).not.toContain("672136036");
    expect(ids).not.toContain("672168187");
  });

  it("drops a deleted reply, and a thread whose opening comment was deleted", async () => {
    serve(
      at(`${PULL}/comments`, () =>
        Response.json({
          values: [
            { ...comments[0], deleted: true, content: { raw: "" } },
            { ...comments[4], parent: { id: 637654717 } },
            comments[3],
            { ...comments[5], deleted: true, content: { raw: "" } },
          ],
        }),
      ),
    );

    const { items } = await provider().threads.list(pull);

    expect(items).toHaveLength(1);
    expect(items[0]?.comments.map((comment) => comment.id)).toEqual(["671727071"]);
  });

  it("reads every page of comments before it groups them", async () => {
    const fetch = serve(
      at(`${PULL}/comments`, (url) =>
        url.searchParams.get("page") === "2"
          ? Response.json({ values: comments.slice(5) })
          : Response.json({
              values: comments.slice(0, 5),
              next: `${PULL}/comments?pagelen=100&page=2`,
            }),
      ),
    );

    const thread = await provider().threads.get(pull, { threadId: "671727071" });

    expect(thread.comments.map((comment) => comment.id)).toEqual([
      "671727071",
      "672130472",
      "672134034",
    ]);
    expect(sent(fetch, 0).url.searchParams.get("pagelen")).toBe("100");
    expect(sent(fetch, 1).url.searchParams.get("page")).toBe("2");
  });

  it("calls a conversation comment no thread", async () => {
    serve(allComments);

    await expect(provider().threads.get(pull, { threadId: "672136036" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("replies under the newest comment, so the reply ends the thread", async () => {
    const fetch = serve(
      (url, init) =>
        init.method === "POST" && url.pathname === new URL(`${PULL}/comments`).pathname
          ? Response.json({
              id: 3000000001,
              created_on: "2026-11-15T12:00:00Z",
              content: { raw: "Done." },
              user: { nickname: "ada" },
              parent: { id: 672134034 },
              inline: inline("README.md", 723),
              links: link(3000000001),
            })
          : undefined,
      allComments,
    );

    const reply = await provider().threads.reply(pull, { threadId: "671727071", body: "Done." });

    expect(reply).toMatchObject({ id: "3000000001", body: "Done.", author: { login: "ada" } });
    const post = sent(fetch, 1);
    expect(post.method).toBe("POST");
    expect(JSON.parse(String(post.body))).toEqual({
      content: { raw: "Done." },
      parent: { id: 672134034 },
    });
  });

  it("resolves an open thread through its opening comment", async () => {
    const fetch = serve(
      at(`${PULL}/comments/672135002/resolve`, () => Response.json({ type: "comment_resolution" })),
      allComments,
    );

    const thread = await provider().threads.resolve(pull, { threadId: "672135002" });

    expect(thread.isResolved).toBe(true);
    expect(sent(fetch, 1)).toMatchObject({ method: "POST" });
  });

  it("reopens a resolved thread with a DELETE", async () => {
    const fetch = serve(
      at(`${PULL}/comments/671727071/resolve`, () => new Response(null, { status: 204 })),
      allComments,
    );

    const thread = await provider().threads.unresolve(pull, { threadId: "671727071" });

    expect(thread.isResolved).toBe(false);
    expect(sent(fetch, 1)).toMatchObject({ method: "DELETE" });
  });

  it("leaves a thread already in the asked state alone, since Bitbucket refuses the repeat", async () => {
    const fetch = serve(allComments);

    const thread = await provider().threads.resolve(pull, { threadId: "671727071" });

    expect(thread.isResolved).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("conversation comments", () => {
  it("asks Bitbucket for the live conversation comments only", async () => {
    const fetch = serve(
      at(`${PULL}/comments`, () =>
        Response.json({
          values: [comments[2], comments[7], comments[8]],
          next: `${PULL}/comments?q=x&pagelen=2&page=2`,
        }),
      ),
    );

    const page = await provider().pullRequests.listComments(pull, { perPage: 2 });

    const { url } = sent(fetch);
    expect(url.searchParams.get("q")).toBe("(deleted=false) AND (inline.path=null)");
    expect(url.searchParams.get("pagelen")).toBe("2");
    expect(page.items.map((comment) => comment.id)).toEqual([
      "637654724",
      "672136036",
      "672168187",
    ]);
    expect(page.items[0]).toEqual({
      id: "637654724",
      body: "##### Please use the feedback collector ",
      author: { login: "Autoreview" },
      url: "https://bitbucket.org/atlassian/atlassian-connect-express/pull-requests/527/_/diff#comment-637654724",
      createdAt: "2025-05-27T00:27:10Z",
      updatedAt: "2025-05-27T00:27:10Z",
    });
    expect(page.nextCursor).toBeTypeOf("string");
  });

  it("continues on the next link Bitbucket sent, filter and all", async () => {
    const fetch = serve(
      at(`${PULL}/comments`, (url) =>
        url.searchParams.get("page") === "2"
          ? Response.json({ values: [comments[8]] })
          : Response.json({
              values: [comments[2]],
              next: `${PULL}/comments?q=%28deleted%3Dfalse%29+AND+%28inline.path%3Dnull%29&pagelen=1&page=2`,
            }),
      ),
    );
    const bitbucket = provider();

    const first = await bitbucket.pullRequests.listComments(pull, { perPage: 1 });
    const second = await bitbucket.pullRequests.listComments(pull, {
      perPage: 1,
      cursor: first.nextCursor,
    });

    expect(second.items.map((comment) => comment.id)).toEqual(["672168187"]);
    expect(second.nextCursor).toBeUndefined();
    expect(sent(fetch, 1).url.searchParams.get("q")).toBe("(deleted=false) AND (inline.path=null)");
  });

  it("caps a page at the 100 rows Bitbucket serves", async () => {
    const fetch = serve(at(`${PULL}/comments`, () => Response.json({ values: [] })));

    await provider().pullRequests.listComments(pull, { perPage: 100 });

    expect(sent(fetch).url.searchParams.get("pagelen")).toBe("100");
  });

  it("finds one conversation comment, and calls an inline one missing", async () => {
    serve(allComments);
    const bitbucket = provider();

    await expect(
      bitbucket.pullRequests.getComment(pull, { commentId: "672136036" }),
    ).resolves.toMatchObject({ body: "do u now when will this feature be relea" });
    await expect(
      bitbucket.pullRequests.getComment(pull, { commentId: "671727071" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("stops reading pages once it finds the comment", async () => {
    const fetch = serve(
      at(`${PULL}/comments`, () =>
        Response.json({ values: comments.slice(0, 3), next: `${PULL}/comments?page=2` }),
      ),
    );

    await provider().pullRequests.getComment(pull, { commentId: "637654724" });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("posts a new comment with its body as raw Markdown", async () => {
    const fetch = serve((url, init) =>
      init.method === "POST" && url.pathname === new URL(`${PULL}/comments`).pathname
        ? Response.json({
            id: 3000000002,
            created_on: "2026-11-15T12:00:00Z",
            updated_on: "2026-11-15T12:00:00Z",
            content: { raw: "Looks good" },
            user: { nickname: "ada" },
            links: link(3000000002),
          })
        : undefined,
    );

    const comment = await provider().pullRequests.createComment(pull, { body: "Looks good" });

    expect(comment).toMatchObject({ id: "3000000002", body: "Looks good" });
    expect(JSON.parse(String(sent(fetch).body))).toEqual({ content: { raw: "Looks good" } });
  });
});

describe("repository contents", () => {
  const meta = (path: string, type: "commit_file" | "commit_directory") => ({
    path,
    type,
    commit: { hash: SHA },
  });

  it("reads a file at the commit its branch resolves to", async () => {
    const fetch = serve(
      at(`${REPO}/commit/master`, () => Response.json({ hash: SHA })),
      at(`${REPO}/src/${SHA}/README.md`, (url) =>
        url.searchParams.get("format") === "meta"
          ? Response.json({ ...meta("README.md", "commit_file"), size: 13 })
          : new Response("# ACE\nHello.\n", { headers: { "content-type": "text/markdown" } }),
      ),
    );

    const file = await provider().repos.readContents(ace, { path: "README.md", ref: "master" });

    expect(file).toMatchObject({
      type: "file",
      path: "README.md",
      sha: SHA,
      size: 13,
      binary: false,
      content: "# ACE\nHello.\n",
      truncated: false,
    });
    expect(sent(fetch, 0).url.pathname).toBe(
      "/2.0/repositories/atlassian/atlassian-connect-express/commit/master",
    );
  });

  it("skips the ref lookup for a full commit SHA", async () => {
    const fetch = serve(
      at(`${REPO}/src/${SHA}/README.md`, (url) =>
        url.searchParams.get("format") === "meta"
          ? Response.json(meta("README.md", "commit_file"))
          : new Response("x"),
      ),
    );

    await provider().repos.readContents(ace, { path: "README.md", ref: SHA });

    expect(fetch.mock.calls.map((call) => new URL(String(call[0])).pathname)).not.toContain(
      `/2.0/repositories/atlassian/atlassian-connect-express/commit/${SHA}`,
    );
  });

  it("lists a directory, every page of it", async () => {
    serve(
      at(`${REPO}/src/${SHA}/lib`, () => Response.json(meta("lib", "commit_directory"))),
      at(`${REPO}/src/${SHA}/lib/`, (url) =>
        url.searchParams.get("page") === "2"
          ? Response.json({
              values: [{ path: "lib/store", type: "commit_directory", commit: { hash: SHA } }],
            })
          : Response.json({
              values: [
                { path: "lib/index.js", type: "commit_file", size: 1200, attributes: [] },
                { path: "lib/bin", type: "commit_file", size: 9, attributes: ["link"] },
              ],
              next: `${REPO}/src/${SHA}/lib/?pagelen=100&page=2`,
            }),
      ),
    );

    const listing = await provider().repos.readContents(ace, { path: "lib", ref: SHA });

    expect(listing).toEqual({
      type: "directory",
      path: "lib",
      sha: SHA,
      entries: [
        { name: "index.js", path: "lib/index.js", type: "file", size: 1200 },
        { name: "bin", path: "lib/bin", type: "symlink", size: null },
        { name: "store", path: "lib/store", type: "directory", size: null },
      ],
      entriesComplete: true,
    });
  });

  it("stops after ten pages and calls the listing incomplete", async () => {
    const fetch = serve(
      at(`${REPO}/src/${SHA}/big`, () => Response.json(meta("big", "commit_directory"))),
      at(`${REPO}/src/${SHA}/big/`, (url) => {
        const page = Number(url.searchParams.get("page") ?? "1");
        return Response.json({
          values: [{ path: `big/${page}.txt`, type: "commit_file", size: 1 }],
          next: `${REPO}/src/${SHA}/big/?pagelen=100&page=${page + 1}`,
        });
      }),
    );

    const listing = await provider().repos.readContents(ace, { path: "big", ref: SHA });

    expect(listing).toMatchObject({ type: "directory", entriesComplete: false });
    expect(listing.type === "directory" && listing.entries).toHaveLength(10);
    expect(fetch).toHaveBeenCalledTimes(11);
  });

  it("lists the root", async () => {
    serve(
      at(`${REPO}/src/${SHA}/`, (url) =>
        url.searchParams.get("format") === "meta"
          ? Response.json(meta("", "commit_directory"))
          : Response.json({ values: [{ path: ".eslintrc", type: "commit_file", size: 815 }] }),
      ),
    );

    const listing = await provider().repos.readContents(ace, { path: "", ref: SHA });

    expect(listing).toMatchObject({
      type: "directory",
      entries: [{ name: ".eslintrc", path: ".eslintrc", type: "file", size: 815 }],
    });
  });

  it("refuses a file over the read limit before downloading it", async () => {
    const fetch = serve(
      at(`${REPO}/src/${SHA}/big.bin`, (url) =>
        url.searchParams.get("format") === "meta"
          ? Response.json({ ...meta("big.bin", "commit_file"), size: 2_000_000 })
          : new Response("x"),
      ),
    );

    await expect(
      provider().repos.readContents(ace, { path: "big.bin", ref: SHA }),
    ).rejects.toMatchObject({ status: 413 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses to continue a read on a moving branch", async () => {
    serve(at(`${REPO}/commit/master`, () => Response.json({ hash: SHA })));

    await expect(
      provider().repos.readContents(ace, { path: "README.md", ref: "master", offset: 10 }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("what Bitbucket Cloud doesn't have", () => {
  it.each([
    ["issues.list", (b: BitbucketProvider) => b.issues.list(ace)],
    ["issues.get", (b: BitbucketProvider) => b.issues.get({ ...ace, number: 1 })],
    ["issues.create", (b: BitbucketProvider) => b.issues.create(ace, { title: "t", body: "b" })],
    ["issues.listComments", (b: BitbucketProvider) => b.issues.listComments({ ...ace, number: 1 })],
    ["releases.list", (b: BitbucketProvider) => b.releases.list(ace)],
    ["releases.get", (b: BitbucketProvider) => b.releases.get(ace, { tag: "v1.0.0" })],
    ["ciRuns.list", (b: BitbucketProvider) => b.ciRuns.list(ace)],
    ["users.get", (b: BitbucketProvider) => b.users.get("atlassian")],
  ])("answers %s with a 501 before any request", async (_, call) => {
    const fetch = serve();

    const failure = call(provider());

    await expect(failure).rejects.toBeInstanceOf(ForgesError);
    await expect(failure).rejects.toMatchObject({ status: 501, platform: "bitbucket" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("points a CI-run reader at the checks Bitbucket does report", async () => {
    serve();

    await expect(provider().ciRuns.list(ace)).rejects.toThrow(
      "read a commit's or pull request's checks",
    );
  });
});

describe("commits", () => {
  it.each([{ since: "2026-01-01T00:00:00Z" }, { until: "2026-01-01T00:00:00Z" }])(
    "answers a date filter with a 501, since Bitbucket would ignore it: %j",
    async (filter) => {
      const fetch = serve();

      await expect(provider().commits.list(ace, filter)).rejects.toMatchObject({
        status: 501,
        platform: "bitbucket",
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("still lists by ref and path", async () => {
    const fetch = serve(at(`${REPO}/commits/main`, () => Response.json({ values: [] })));

    await provider().commits.list(ace, { ref: "main", path: "README.md" });

    expect(sent(fetch).url.searchParams.get("path")).toBe("README.md");
  });
});

describe("refusals", () => {
  it("turns a missing repository into NotFoundError", async () => {
    serve(
      at(`${API}/repositories/atlassian/nope`, () =>
        refusal(
          404,
          "You may not have access to this repository or it no longer exists in this workspace.",
        ),
      ),
    );

    await expect(provider().repos.get({ owner: "atlassian", repo: "nope" })).rejects.toMatchObject({
      status: 404,
      platform: "bitbucket",
    });
  });

  it("keeps a workspace or slug to one path segment", async () => {
    const fetch = serve();

    await expect(
      provider().threads.list({ owner: "atlassian", repo: "../admin", number: 1 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

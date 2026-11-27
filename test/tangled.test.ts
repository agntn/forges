/**
 * Tangled provider tests
 * Runs the real `forges/tangled` client against a stubbed fetch, so XRPC answers, DID lookups and
 * refusals go through the same parsing a live response does.
 */

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createProvider } from "../src/index.ts";
import { TangledProvider } from "../src/providers/tangled.ts";

const API = "https://api.tangled.org/xrpc";
const OWNER = "did:plc:wshs7t2adsemcrrd4snkeqli";
const REPO = "did:plc:g66xej5jct643d6bgukldn77";
const SHA = "8c8801ec3ae2daa682f3f1a42d340190aa952d46";
const site = { owner: "tangled.org", repo: "site" };

type Route = (url: URL, init: RequestInit) => Response | undefined;

/* tangled.org/site as the live index returned it on 2026-11-27, trimmed. */
const manifest = {
  cid: "bafyreia3fylrzuvb4i7fp6bf3rryayoflqbm4pj3f6cpgg4o7pky6haa4q",
  defaultBranch: "master",
  knot: "knot1.tangled.sh",
  uri: `at://${REPO}/org.tangled.repo.manifest/self`,
  value: {
    $type: "org.tangled.repo.manifest",
    createdAt: "2025-02-28T22:44:51.000000Z",
    declaration: { name: "site", owner: OWNER },
    description: "engineering blog at https://blog.tangled.org",
  },
};

/* The owner's PLC document, which turns its DID back into the handle. */
const ownerDocument = {
  id: OWNER,
  alsoKnownAs: ["at://tangled.org"],
  service: [
    {
      id: "#atproto_pds",
      type: "AtprotoPersonalDataServer",
      serviceEndpoint: "https://oysterling.us-west.host.bsky.network",
    },
  ],
};

/* The commit HEAD named on 2026-11-27. */
const head = {
  commits: [
    {
      author: {
        email: "anirudh@tangled.org",
        name: "Anirudh Oppiliappan",
        when: "2026-03-18T16:42:13.000000+02:00",
      },
      committer: {
        email: "anirudh@tangled.org",
        name: "Anirudh Oppiliappan",
        when: "2026-03-18T16:42:26.000000+02:00",
      },
      message: "misc sh -> org\n",
      oid: SHA,
      parents: ["b082516a07776925a59faf79ac32a73a6f286bfc"],
    },
  ],
};

/* One row of `getTree`, without the last commit the mirror adds to it. */
function row(name: string, mode: string, size?: number) {
  return { mode, name, ...(size === undefined ? {} : { size }) };
}

const root = {
  entries: [
    row(".gitignore", "0100644", 66),
    row("config.yaml", "0100644", 254),
    row("pages", "0040000"),
    row("huge.bin", "0100644", 2_000_000),
    row("theme", "0160000"),
  ],
};

const pages = { entries: [row("_index.md", "0100644", 96), row("blog", "0040000")] };

const config =
  "preBuild:\n  - tailwindcss -i input.css -o static/tw.css\ntitle: tangled engineering\n";

function serve(...routes: Route[]) {
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    return Response.json({ error: "RecordNotFound", message: "record not found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/* Answers one XRPC method, or one absolute URL, when every given query parameter matches. */
function at(target: string, body: unknown, query: Record<string, string | undefined> = {}): Route {
  const path = target.startsWith("https://") ? target : `${API}/${target}`;
  return (url) => {
    if (`${url.origin}${url.pathname}` !== path) return undefined;
    for (const [key, value] of Object.entries(query)) {
      if (url.searchParams.get(key) !== (value ?? null)) return undefined;
    }
    return typeof body === "string" ? new Response(body) : Response.json(body);
  };
}

/* Everything `repos.get` reads to find tangled.org/site by its owner's handle. */
const repository: Route[] = [
  at("com.atproto.identity.resolveHandle", { did: OWNER }, { handle: "tangled.org" }),
  at(`https://plc.directory/${OWNER}`, ownerDocument),
  at("org.tangled.repo.getRepoByName", manifest, { owner: OWNER, name: "site" }),
  at("org.tangled.repo.countForks", { count: 3 }),
  at("org.tangled.feed.countStars", { count: 33 }),
];

const handleRoute = at("https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle", {
  did: OWNER,
});

const contents: Route[] = [
  handleRoute,
  ...repository,
  at("org.tangled.temp.git.listCommitsByRef", head),
  at("org.tangled.temp.git.getTree", root, { ref: SHA, path: undefined }),
  at("org.tangled.temp.git.getTree", pages, { ref: SHA, path: "pages" }),
  at("org.tangled.temp.git.getEntry", { mode: "0100644", name: "config.yaml", size: 254 }),
  at("org.tangled.temp.git.getBlob", config, { ref: SHA, path: "config.yaml" }),
];

function paths(fetch: ReturnType<typeof serve>): string[] {
  return fetch.mock.calls.map(([input]) => new URL(String(input)).pathname.replace("/xrpc/", ""));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("TangledProvider repositories", () => {
  it("names a repository by its owner's handle, not the DID forges keys it by", async () => {
    serve(handleRoute, ...repository);

    const read = await new TangledProvider({ token: "" }).repos.get(site);

    expect(read).toMatchObject({
      id: REPO,
      name: "site",
      fullName: "tangled.org/site",
      owner: { login: "tangled.org" },
      defaultBranch: "master",
      url: "https://tangled.org/tangled.org/site",
      private: false,
    });
  });

  it("reads anonymously through createProvider when no login is set", async () => {
    vi.stubEnv("TANGLED_HANDLE", "");
    vi.stubEnv("TANGLED_PASSWORD", "");
    serve(handleRoute, ...repository);

    const tangled = await createProvider("tangled", { token: "" });

    expect(tangled).toBeInstanceOf(TangledProvider);
    expect((await tangled.repos.get(site)).fullName).toBe("tangled.org/site");
  });
});

describe("TangledProvider contents", () => {
  it("lists one directory level, sizes kept for files", async () => {
    serve(...contents);

    const read = await new TangledProvider({ token: "" }).repos.readContents(site, {
      path: "pages",
    });

    expect(read).toEqual({
      type: "directory",
      path: "pages",
      sha: SHA,
      entries: [
        { name: "_index.md", path: "pages/_index.md", type: "file", size: 96 },
        { name: "blog", path: "pages/blog", type: "directory", size: null },
      ],
      entriesComplete: true,
    });
  });

  it("reads a file at the commit its ref resolved to", async () => {
    const fetch = serve(...contents);

    const read = await new TangledProvider({ token: "" }).repos.readContents(site, {
      path: "config.yaml",
      maxChars: 9,
    });

    expect(read).toMatchObject({
      type: "file",
      path: "config.yaml",
      sha: SHA,
      content: "preBuild:",
      nextOffset: 9,
      truncated: true,
    });
    expect(paths(fetch).filter((path) => path.startsWith("org.tangled.temp.git"))).toEqual([
      "org.tangled.temp.git.listCommitsByRef",
      "org.tangled.temp.git.getTree",
      "org.tangled.temp.git.getEntry",
      "org.tangled.temp.git.getBlob",
    ]);
  });

  it("refuses a file over the read limit before asking for its bytes", async () => {
    const fetch = serve(...contents);

    await expect(
      new TangledProvider({ token: "" }).repos.readContents(site, { path: "huge.bin" }),
    ).rejects.toMatchObject({ status: 413, platform: "tangled" });
    expect(paths(fetch)).not.toContain("org.tangled.temp.git.getBlob");
  });

  it("names a submodule instead of reading it", async () => {
    serve(...contents);

    await expect(
      new TangledProvider({ token: "" }).repos.readContents(site, { path: "theme" }),
    ).rejects.toMatchObject({ status: 422, message: expect.stringContaining("submodule") });
  });

  it.each(["nope.txt", "pages/nope.md", "nope/deeper.md"])(
    "answers 404 for %s, which no tree lists",
    async (path) => {
      serve(...contents);

      await expect(
        new TangledProvider({ token: "" }).repos.readContents(site, { path }),
      ).rejects.toMatchObject({ status: 404, message: `No file or directory at ${path}` });
    },
  );
});

describe("TangledProvider commits", () => {
  it("answers 501 for a date filter the mirror would drop, before any request", async () => {
    const fetch = serve();

    await expect(
      new TangledProvider({ token: "" }).commits.list(site, { since: "2026-01-01T00:00:00Z" }),
    ).rejects.toMatchObject({ status: 501, message: expect.stringContaining("Drop since") });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says the range is too large when the mirror refuses the patch", async () => {
    serve(...contents, at("org.tangled.temp.git.getMergeBase", { commit: SHA }), (url) =>
      url.pathname.endsWith("org.tangled.temp.git.formatPatch")
        ? new Response("too large", { status: 413 })
        : undefined,
    );

    await expect(
      new TangledProvider({ token: "" }).commits.compare(site, { base: "v1", head: "v2" }),
    ).rejects.toMatchObject({ status: 413, message: expect.stringContaining("too large") });
  });
});

describe("TangledProvider auth", () => {
  it("refuses an app password without the account it belongs to, before any request", async () => {
    const fetch = serve();

    for (const username of [undefined, "", "  "]) {
      expect(() => new TangledProvider({ token: "app-password", username })).toThrow(
        expect.objectContaining({
          status: 400,
          message: expect.stringContaining("TANGLED_HANDLE"),
        }),
      );
    }
    await expect(createProvider("tangled", { token: "app-password" })).rejects.toMatchObject({
      status: 400,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("signs in at the PDS with the handle and app password", async () => {
    const fetch = serve(
      handleRoute,
      ...repository,
      at("https://oysterling.us-west.host.bsky.network/xrpc/com.atproto.server.createSession", {
        did: OWNER,
        handle: "tangled.org",
        accessJwt: "access",
        refreshJwt: "refresh",
      }),
    );

    const me = await new TangledProvider({
      token: "app-password",
      username: "tangled.org",
    }).users.authenticated();

    expect(me).toMatchObject({ id: OWNER, login: "tangled.org" });

    const session = fetch.mock.calls.find(([input]) =>
      String(input).endsWith("com.atproto.server.createSession"),
    );
    expect(JSON.parse(String(session?.[1]?.body))).toEqual({
      identifier: "tangled.org",
      password: "app-password",
    });
  });
});

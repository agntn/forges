/**
 * Azure DevOps provider tests
 * Runs the real `forges/azure-devops` client against a stubbed fetch, so owners, pages and
 * refusals go through the same parsing a live response does.
 */

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AzureDevOpsProvider } from "../src/providers/azure-devops.ts";
import { AuthenticationError, NotFoundError } from "../src/errors.ts";

const ORG = "https://dev.azure.com/dnceng-public";
const REPO = `${ORG}/public/_apis/git/repositories/dotnet-public-wiki`;
const SHA = "af56d96fdbd7c26e9fc94336b6f50dcc6ceff484";
const BASE = "2adc745e20d7a07fb7f177853d3e78a95b007aef";
const wiki = { owner: "dnceng-public/public", repo: "dotnet-public-wiki" };

type Route = (url: URL, init: RequestInit) => Response | undefined;

/* dnceng-public/public/dotnet-public-wiki as the live API returned it on 2026-11-15, trimmed. */
const repository = {
  id: "2459d599-fdb2-4d28-9810-daeec061cf90",
  name: "dotnet-public-wiki",
  project: { id: "cbb18261-c48f-4abb-8651-8cdcb5474649", name: "public", visibility: "public" },
  defaultBranch: "refs/heads/main",
  remoteUrl: "https://dnceng-public@dev.azure.com/dnceng-public/public/_git/dotnet-public-wiki",
  sshUrl: "git@ssh.dev.azure.com:v3/dnceng-public/public/dotnet-public-wiki",
  webUrl: "https://dev.azure.com/dnceng-public/public/_git/dotnet-public-wiki",
  isDisabled: false,
};

function commit(commitId: string, comment: string, date: string) {
  return {
    commitId,
    author: { name: "MerlinBot", email: null, date },
    committer: { name: "MerlinBot", email: null, date },
    comment,
    remoteUrl: `https://dev.azure.com/dnceng-public/public/_git/dotnet-public-wiki/commit/${commitId}`,
  };
}

/* The newest three commits of the same repository, as the log sent them. */
const log = [
  commit(SHA, "Merge pull request 5 from invBootstrap into main", "2026-02-18T04:35:04Z"),
  commit(
    "6573a31da8967bc68b9344ec48aeb38df3435be0",
    "Merge pull request 5 from invBootstrap into main",
    "2026-02-18T04:35:02Z",
  ),
  commit(BASE, "Added Artifacts Feeds", "2026-02-05T16:00:21Z"),
];

/* A review thread on a file, shaped like the Pull Request Threads - List example in Microsoft's docs. */
const fileThread = {
  id: 148,
  status: "active",
  threadContext: {
    filePath: "/README.md",
    rightFileStart: { line: 4, offset: 1 },
    rightFileEnd: { line: 6, offset: 1 },
  },
  comments: [
    {
      id: 1,
      parentCommentId: 0,
      author: { displayName: "Normal Paulk", uniqueName: "fabrikamfiber16@hotmail.com" },
      content: "Should we add a comment about what this value means?",
      publishedDate: "2016-11-01T16:30:50.083Z",
      commentType: "text",
    },
    {
      id: 2,
      parentCommentId: 1,
      author: { displayName: "Normal Paulk", uniqueName: "fabrikamfiber16@hotmail.com" },
      content: "Good idea",
      publishedDate: "2016-11-01T16:30:51.383Z",
      commentType: "text",
    },
  ],
};

/* Thread 12 of dotnet-public-wiki#5: a bot's conversation comment, closed, on no file. */
const conversationThread = {
  id: 12,
  status: "closed",
  threadContext: null,
  comments: [
    {
      id: 1,
      parentCommentId: 0,
      author: { displayName: "MerlinBot", uniqueName: null },
      content: "## Valid",
      publishedDate: "2026-02-18T04:35:14.04Z",
      commentType: "text",
    },
  ],
};

function serve(...routes: Route[]) {
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    return Response.json(
      { message: "TF401019: The Git repository does not exist." },
      { status: 404 },
    );
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function at(path: string, body: (url: URL, init: RequestInit) => unknown): Route {
  return (url, init) =>
    url.pathname === new URL(path).pathname ? Response.json(body(url, init)) : undefined;
}

function calls(fetch: ReturnType<typeof serve>): { url: URL; init: RequestInit }[] {
  return fetch.mock.calls.map(([input, init]) => ({
    url: new URL(String(input instanceof Request ? input.url : input)),
    init: init ?? {},
  }));
}

function provider(config: { baseURL?: string } = {}): AzureDevOpsProvider {
  return new AzureDevOpsProvider({ token: "pat", ...config });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AzureDevOpsProvider owners", () => {
  it("reads organization/project as the owner", async () => {
    serve(at(REPO, () => repository));

    const repo = await provider().repos.get(wiki);

    expect(repo).toMatchObject({
      fullName: "dnceng-public/public/dotnet-public-wiki",
      defaultBranch: "main",
      private: false,
    });
  });

  it("takes the bare project once baseURL names the organization", async () => {
    const fetch = serve(at(REPO, () => repository));

    await provider({ baseURL: ORG }).repos.get({ owner: "public", repo: "dotnet-public-wiki" });

    expect(calls(fetch)[0]?.url.pathname).toBe(new URL(REPO).pathname);
  });

  it.each([
    ["https://acme.visualstudio.com", "acme"],
    ["https://dev.azure.com/acme/", "acme"],
  ])("reads the organization out of %s", async (baseURL, organization) => {
    const fetch = serve(
      at(`https://dev.azure.com/${organization}/web/_apis/git/repositories/site`, () => repository),
    );

    await provider({ baseURL }).repos.get({ owner: "web", repo: "site" });

    expect(fetch).toHaveBeenCalledOnce();
  });

  it("refuses a baseURL that names no organization, as Azure DevOps Server's would", () => {
    expect(() => provider({ baseURL: "https://tfs.example.com/tfs" })).toThrow(
      "Azure DevOps Server isn't supported",
    );
  });

  it("refuses a bare project with no organization to put it in, before any request", async () => {
    const fetch = serve();

    await expect(
      provider().repos.get({ owner: "public", repo: "dotnet-public-wiki" }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("organization/project"),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["dnceng-public/..", "../public", "dnceng-public/a/b", "dnceng-public/"])(
    "refuses the owner %s before any request",
    async (owner) => {
      const fetch = serve();

      await expect(provider().repos.get({ owner, repo: "x" })).rejects.toMatchObject({
        status: 400,
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("lists the repositories of one project", async () => {
    const fetch = serve(
      at(`${ORG}/public/_apis/git/repositories`, () => ({ value: [repository] })),
    );

    const page = await provider().repos.list("dnceng-public/public");

    expect(page.items.map((item) => item.name)).toEqual(["dotnet-public-wiki"]);
    expect(calls(fetch)[0]?.url.pathname).toBe("/dnceng-public/public/_apis/git/repositories");
  });

  it("asks for a 401 instead of the sign-in redirect", async () => {
    const fetch = serve((url, init) =>
      new Headers(init.headers).get("x-tfs-fedauthredirect") === "Suppress"
        ? Response.json({ message: "TF400813: not authorized" }, { status: 401 })
        : new Response(null, { status: 302, headers: { location: "https://login.example" } }),
    );

    await expect(provider().repos.get(wiki)).rejects.toBeInstanceOf(AuthenticationError);
    expect(fetch).toHaveBeenCalled();
  });
});

describe("AzureDevOpsProvider commits", () => {
  it("pages the log on $skip and reads one row past the page to know there's more", async () => {
    const fetch = serve(
      at(`${REPO}/commits`, (url) => {
        const skip = Number(url.searchParams.get("searchCriteria.$skip"));
        const top = Number(url.searchParams.get("searchCriteria.$top"));
        return { value: log.slice(skip, skip + top) };
      }),
    );
    const azure = provider();

    const first = await azure.commits.list(wiki, { perPage: 2 });
    const second = await azure.commits.list(wiki, { perPage: 2, cursor: first.nextCursor });

    expect(first.items.map((item) => item.sha.slice(0, 7))).toEqual(["af56d96", "6573a31"]);
    expect(second.items.map((item) => item.sha.slice(0, 7))).toEqual(["2adc745"]);
    expect(second.nextCursor).toBeUndefined();
    expect(calls(fetch).map(({ url }) => url.searchParams.get("searchCriteria.$skip"))).toEqual([
      "0",
      "2",
    ]);
  });

  it("sends since, until, path and a tag ref the way the log reads them", async () => {
    const fetch = serve(at(`${REPO}/commits`, () => ({ value: [] })));

    await provider().commits.list(wiki, {
      ref: "refs/tags/v1.0",
      path: "docs",
      since: "2026-01-01",
      until: "2026-02-01T00:00:00+01:00",
    });

    const query = calls(fetch)[0]?.url.searchParams;
    expect(Object.fromEntries(query ?? [])).toMatchObject({
      "searchCriteria.itemVersion.version": "v1.0",
      "searchCriteria.itemVersion.versionType": "tag",
      "searchCriteria.itemPath": "/docs",
      "searchCriteria.fromDate": "2026-01-01T00:00:00.000Z",
      "searchCriteria.toDate": "2026-01-31T23:00:00.000Z",
    });
  });

  it("writes commit dates the way commits.get does", async () => {
    serve(at(`${REPO}/commits`, () => ({ value: [log[0]] })));

    const page = await provider().commits.list(wiki);

    expect(page.items[0]?.author).toEqual({
      name: "MerlinBot",
      email: "",
      date: "2026-02-18T04:35:04.000Z",
    });
  });

  it("refuses a date it can't read before any request", async () => {
    const fetch = serve();

    await expect(provider().commits.list(wiki, { since: "yesterday" })).rejects.toMatchObject({
      status: 400,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lists a range oldest first next to the files that changed", async () => {
    serve(
      at(`${REPO}/diffs/commits`, () => ({
        aheadCount: 2,
        behindCount: 0,
        commonCommit: BASE,
        allChangesIncluded: true,
        changes: [{ item: { path: "/es-metadata.yml" }, changeType: "add" }],
      })),
      at(`${REPO}/commits`, (url) => {
        expect(url.searchParams.get("searchCriteria.compareVersion.version")).toBe(SHA);
        return { value: log.slice(0, 2) };
      }),
    );

    const comparison = await provider().commits.compare(wiki, { base: BASE, head: SHA });

    expect(comparison.items.map((item) => item.sha.slice(0, 7))).toEqual(["6573a31", "af56d96"]);
    expect(comparison).toMatchObject({
      aheadBy: 2,
      behindBy: 0,
      mergeBaseSha: BASE,
      files: [{ path: "es-metadata.yml", status: "added" }],
      filesComplete: true,
    });
  });
});

describe("AzureDevOpsProvider repository contents", () => {
  const items = (value: unknown[]) => at(`${REPO}/items`, () => ({ count: value.length, value }));

  it("lists a directory at the commit the default branch resolves to", async () => {
    const fetch = serve(
      at(REPO, () => repository),
      at(`${REPO}/commits`, () => ({ value: [log[0]] })),
      items([
        { path: "/", gitObjectType: "tree", isFolder: true },
        { path: "/Home.md", gitObjectType: "blob", objectId: "b79e" },
        { path: "/docs", gitObjectType: "tree", isFolder: true },
        { path: "/vendor", gitObjectType: "commit" },
      ]),
    );

    const root = await provider().repos.readContents(wiki, { path: "" });

    expect(root).toEqual({
      type: "directory",
      path: "",
      sha: SHA,
      entries: [
        { name: "Home.md", path: "Home.md", type: "file", size: null },
        { name: "docs", path: "docs", type: "directory", size: null },
        { name: "vendor", path: "vendor", type: "submodule", size: null },
      ],
      entriesComplete: true,
    });
    expect(Object.fromEntries(calls(fetch).at(-1)?.url.searchParams ?? [])).toMatchObject({
      scopePath: "/",
      "versionDescriptor.version": SHA,
      "versionDescriptor.versionType": "commit",
    });
  });

  it("reads a file through its blob, size first", async () => {
    const text = "# Welcome to the .NET Engineering Services Customer Landing Page\n";
    const fetch = serve(
      items([{ path: "/Home.md", gitObjectType: "blob", objectId: "b79e" }]),
      (url) => {
        if (!url.pathname.endsWith("/blobs/b79e")) return undefined;
        return url.searchParams.get("$format") === "octetstream"
          ? new Response(text, { headers: { "content-type": "application/octet-stream" } })
          : Response.json({ objectId: "b79e", size: text.length });
      },
    );

    const file = await provider().repos.readContents(wiki, { path: "Home.md", ref: SHA });

    expect(file).toMatchObject({ type: "file", sha: SHA, size: text.length, content: text });
    expect(calls(fetch)).toHaveLength(3);
  });

  it("stops at the blob's size when the file is too big to read", async () => {
    const fetch = serve(
      items([{ path: "/big.bin", gitObjectType: "blob", objectId: "b1g" }]),
      at(`${REPO}/blobs/b1g`, () => ({ objectId: "b1g", size: 5_000_000 })),
    );

    await expect(
      provider().repos.readContents(wiki, { path: "big.bin", ref: SHA }),
    ).rejects.toMatchObject({ status: 413 });
    expect(calls(fetch)).toHaveLength(2);
  });

  it("calls a path Azure DevOps doesn't know missing", async () => {
    serve();

    await expect(
      provider().repos.readContents(wiki, { path: "nope.md", ref: SHA }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("AzureDevOpsProvider review threads", () => {
  const PULL = `${REPO}/pullRequests/5`;
  const pull = { ...wiki, number: 5 };

  it("keeps the threads on a file and leaves conversation threads to the comments", async () => {
    serve(at(`${PULL}/threads`, () => ({ value: [conversationThread, fileThread] })));

    const page = await provider().threads.list(pull);

    expect(page.items).toEqual([
      {
        id: "148",
        isResolved: false,
        isOutdated: false,
        path: "README.md",
        line: 6,
        startLine: 4,
        comments: [
          expect.objectContaining({
            id: "1",
            author: { login: "fabrikamfiber16@hotmail.com" },
            url: "https://dev.azure.com/dnceng-public/public/_git/dotnet-public-wiki/pullrequest/5?discussionId=148",
          }),
          expect.objectContaining({ id: "2", body: "Good idea" }),
        ],
      },
    ]);
  });

  it("replies to the comment that opened the thread", async () => {
    const fetch = serve(
      at(`${PULL}/threads`, () => ({ value: [fileThread] })),
      (url, init) =>
        url.pathname.endsWith("/threads/148/comments") && init.method === "POST"
          ? Response.json({ ...fileThread.comments[1], id: 3, content: "On it" })
          : undefined,
    );

    const reply = await provider().threads.reply(pull, { threadId: "148", body: "On it" });

    expect(reply).toMatchObject({ id: "3", body: "On it" });
    expect(JSON.parse(String(calls(fetch).at(-1)?.init.body))).toEqual({
      content: "On it",
      parentCommentId: 1,
      commentType: 1,
    });
  });

  it("resolves as fixed, the status the web UI's Resolve button sets, and only once", async () => {
    let status = "active";
    const fetch = serve(
      at(`${PULL}/threads`, () => ({ value: [{ ...fileThread, status }] })),
      (url, init) => {
        if (!url.pathname.endsWith("/threads/148") || init.method !== "PATCH") return undefined;
        status = (JSON.parse(String(init.body)) as { status: string }).status;
        return Response.json({ ...fileThread, status });
      },
    );
    const azure = provider();

    const resolved = await azure.threads.resolve(pull, { threadId: "148" });
    await azure.threads.resolve(pull, { threadId: "148" });

    expect(resolved.isResolved).toBe(true);
    expect(status).toBe("fixed");
    expect(calls(fetch).filter(({ init }) => init.method === "PATCH")).toHaveLength(1);
  });

  it("calls a conversation thread's id missing", async () => {
    serve(at(`${PULL}/threads`, () => ({ value: [conversationThread] })));

    await expect(provider().threads.get(pull, { threadId: "12" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("AzureDevOpsProvider refusals", () => {
  it.each([
    ["releases", (azure: AzureDevOpsProvider) => azure.releases.list(wiki)],
    ["CI runs", (azure: AzureDevOpsProvider) => azure.ciRuns.list(wiki)],
  ])("answers %s with a 501 before any request", async (_, call) => {
    const fetch = serve();

    await expect(call(provider())).rejects.toMatchObject({ status: 501 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

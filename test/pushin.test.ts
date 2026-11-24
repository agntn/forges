/**
 * Pushin.eu provider tests
 * Runs the real `forges/pushin` client against a stubbed fetch, so Link pages and refusals go
 * through the same parsing a live response does.
 */

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { PushinProvider } from "../src/providers/pushin.ts";

const API = "https://pushin.eu/api/v1";
const REPO = `${API}/repos/pjullrich/pushin`;
const tracker = { owner: "pjullrich", repo: "pushin" };

type Route = (url: URL, init: RequestInit) => Response | undefined;

/* pjullrich/pushin as the live API returned it on 2026-11-24. */
const repository = {
  id: 3,
  name: "pushin",
  owner: { type: "User", login: "pjullrich", html_url: "https://pushin.eu/pjullrich" },
  private: false,
  description: "Leave your comments and feedback for Pushin.eu in this repo!",
  url: `${REPO}`,
  updated_at: "2026-11-23T17:24:34.753817Z",
  topics: [],
  created_at: "2026-07-11T17:16:01.893622Z",
  full_name: "pjullrich/pushin",
  visibility: "public",
  homepage: null,
  default_branch: "main",
  html_url: "https://pushin.eu/pjullrich/pushin",
  node_id: "repo_033njmWmzIFsMhzbVEe4Kh",
  clone_url: "https://git.pushin.eu/pjullrich/pushin.git",
  forks_count: 1,
  stargazers_count: 34,
  watchers_count: 0,
};

const krios = {
  id: 760,
  type: "User",
  login: "krios",
  html_url: "https://pushin.eu/krios",
  avatar_url: "https://cdn.pushin.eu/-/avatars/u_034yli8xAEUXQKcI5NIIho",
  node_id: "u_034yli8xAEUXQKcI5NIIho",
};

/* Issue #67 from the same day, body cut to its first sentence. */
const issue = {
  id: 9482,
  state: "open",
  user: krios,
  number: 67,
  title: "Some repo information missing",
  body: "It is unclear what language(s) are used in repo.",
  labels: [],
  url: `${REPO}/issues/67`,
  updated_at: "2026-11-19T23:03:49.969428Z",
  created_at: "2026-11-19T23:03:49.969428Z",
  closed_at: null,
  html_url: "https://pushin.eu/pjullrich/pushin/issues/67",
  node_id: "iss_0350XjM9mMevqk8sUGfTkU",
  repository_url: REPO,
};

/* A pull request as `GET …/pulls/:number` describes it. No public one had inline comments. */
const pull = {
  id: 12,
  number: 9,
  state: "open",
  title: "Show repository languages",
  body: null,
  user: krios,
  labels: [],
  draft: false,
  merged: false,
  merged_at: null,
  head: { ref: "languages", sha: "1cd7aa6b05d4352d783c8525529330aa14fde6b8" },
  base: { ref: "main" },
  html_url: "https://pushin.eu/pjullrich/pushin/pulls/9",
  node_id: "pr_1",
  created_at: "2026-11-20T10:00:00Z",
  updated_at: "2026-11-20T11:00:00Z",
};

/* One `GET …/pulls/:number/comments` row, shaped by the OpenAPI `ReviewComment` schema. */
function inline(id: number, change: Readonly<Partial<Record<string, unknown>>> = {}) {
  return {
    id,
    node_id: `com_${id}`,
    body: `comment ${id}`,
    user: krios,
    path: "lib/pushin/repo.ex",
    line: 12,
    side: "RIGHT",
    start_line: null,
    start_side: null,
    in_reply_to_id: null,
    pull_request_review_id: null,
    resolved: false,
    diff_hunk: "@@ -10,3 +10,4 @@",
    commit_id: null,
    html_url: `https://pushin.eu/pjullrich/pushin/pulls/9#comment-${id}`,
    created_at: "2026-11-20T10:30:00Z",
    updated_at: "2026-11-20T10:30:00Z",
    ...change,
  };
}

function serve(...routes: Route[]) {
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    return Response.json(
      { message: "Not Found", documentation_url: "https://pushin.eu/docs/api" },
      { status: 404 },
    );
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function at(
  path: string,
  body: (url: URL) => unknown,
  headers: Record<string, string> = {},
): Route {
  return (url) =>
    url.pathname === new URL(path).pathname ? Response.json(body(url), { headers }) : undefined;
}

function urls(fetch: ReturnType<typeof serve>): string[] {
  return fetch.mock.calls.map(([input]) =>
    String(input instanceof Request ? input.url : input).replace(API, ""),
  );
}

function provider(): PushinProvider {
  return new PushinProvider({ token: "pun_test" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PushinProvider repositories", () => {
  it("reads a repository, cloned from git.pushin.eu", async () => {
    const fetch = serve(at(REPO, () => repository));

    const read = await provider().repos.get(tracker);

    expect(read).toMatchObject({
      id: "repo_033njmWmzIFsMhzbVEe4Kh",
      fullName: "pjullrich/pushin",
      defaultBranch: "main",
      private: false,
      url: "https://pushin.eu/pjullrich/pushin",
      cloneUrl: "https://git.pushin.eu/pjullrich/pushin.git",
    });
    expect(urls(fetch)).toEqual(["/repos/pjullrich/pushin"]);
  });

  it("adds /api/v1 to a bare instance root", async () => {
    const fetch = serve(
      at("https://pushin.example.test/api/v1/repos/pjullrich/pushin", () => repository),
    );

    await new PushinProvider({ baseURL: "https://pushin.example.test", token: "" }).repos.get(
      tracker,
    );

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://pushin.example.test/api/v1/repos/pjullrich/pushin",
    );
  });

  it("answers 501 for a commit log, which Pushin.eu has no route for", async () => {
    const fetch = serve();

    await expect(provider().commits.list(tracker)).rejects.toMatchObject({
      status: 501,
      platform: "pushin",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("PushinProvider issues", () => {
  it("lists issues and follows the Link header", async () => {
    const fetch = serve(
      at(`${REPO}/issues`, () => [issue], {
        link: `<${REPO}/issues?page=2&per_page=1&state=all>; rel="next"`,
      }),
    );

    const page = await provider().issues.list(tracker, { state: "all", perPage: 1 });

    expect(page.items).toEqual([
      expect.objectContaining({
        id: "iss_0350XjM9mMevqk8sUGfTkU",
        number: 67,
        state: "open",
        author: { login: "krios" },
      }),
    ]);
    expect(page.nextCursor).toBeTypeOf("string");
    expect(urls(fetch)).toEqual(["/repos/pjullrich/pushin/issues?state=all&per_page=1"]);
  });
});

describe("PushinProvider review threads", () => {
  it("groups inline comments without a review, replies included, by their root", async () => {
    const fetch = serve(
      at(`${REPO}/pulls/9`, () => pull),
      at(`${REPO}/pulls/9/comments`, () => [
        inline(1, { resolved: true }),
        inline(2, { path: "README.md", line: 3 }),
        inline(3, { in_reply_to_id: 1, resolved: true }),
      ]),
    );

    const page = await provider().threads.list({ ...tracker, number: 9 }, { state: "all" });

    expect(page.items).toEqual([
      expect.objectContaining({
        id: "1",
        isResolved: true,
        path: "lib/pushin/repo.ex",
        line: 12,
        comments: [
          expect.objectContaining({ id: "1", body: "comment 1", author: { login: "krios" } }),
          expect.objectContaining({ id: "3", body: "comment 3" }),
        ],
      }),
      expect.objectContaining({ id: "2", isResolved: false, path: "README.md", line: 3 }),
    ]);
    expect(urls(fetch)).toContain("/repos/pjullrich/pushin/pulls/9/comments?per_page=100&page=1");
  });

  it("reads every page of inline comments before grouping them", async () => {
    const fetch = serve(
      at(`${REPO}/pulls/9`, () => pull),
      (url) =>
        url.pathname.endsWith("/pulls/9/comments") && url.searchParams.get("page") === "1"
          ? Response.json([inline(1)], {
              headers: { link: `<${REPO}/pulls/9/comments?page=2>; rel="next"` },
            })
          : undefined,
      at(`${REPO}/pulls/9/comments`, () => [inline(2, { in_reply_to_id: 1 })]),
    );

    const thread = await provider().threads.get({ ...tracker, number: 9 }, { threadId: "1" });

    expect(thread.comments.map((comment) => comment.id)).toEqual(["1", "2"]);
    expect(urls(fetch).filter((url) => url.includes("/comments"))).toEqual([
      "/repos/pjullrich/pushin/pulls/9/comments?per_page=100&page=1",
      "/repos/pjullrich/pushin/pulls/9/comments?per_page=100&page=2",
    ]);
  });

  it("keeps an imported author, who comes without an id", async () => {
    serve(
      at(`${REPO}/pulls/9`, () => pull),
      at(`${REPO}/pulls/9/comments`, () => [
        inline(1, { user: { type: "User", login: "octocat", html_url: null, avatar_url: null } }),
        inline(2, { user: null }),
      ]),
    );

    const page = await provider().threads.list({ ...tracker, number: 9 });

    expect(
      page.items.flatMap((thread) => thread.comments.map((comment) => comment.author)),
    ).toEqual([{ login: "octocat" }, { login: "" }]);
  });

  it("resolves a thread and replies to it through its root comment", async () => {
    const fetch = serve(
      at(`${REPO}/pulls/9`, () => pull),
      at(`${REPO}/pulls/9/comments`, () => [inline(1), inline(3, { in_reply_to_id: 1 })]),
      at(`${REPO}/pulls/comments/1`, () => inline(1, { resolved: true })),
      at(`${REPO}/pulls/9/comments/1/replies`, () => inline(4, { in_reply_to_id: 1 })),
    );
    const pr = { ...tracker, number: 9 };

    await expect(provider().threads.resolve(pr, { threadId: "1" })).resolves.toMatchObject({
      id: "1",
      isResolved: true,
    });
    await expect(
      provider().threads.reply(pr, { threadId: "1", body: "done" }),
    ).resolves.toMatchObject({
      id: "4",
    });
    const writes = fetch.mock.calls.flatMap(([input, init]) =>
      init?.method === "PATCH" || init?.method === "POST"
        ? [[init.method, String(input).replace(API, ""), String(init.body)]]
        : [],
    );
    expect(writes).toEqual([
      ["PATCH", "/repos/pjullrich/pushin/pulls/comments/1", '{"resolved":true}'],
      ["POST", "/repos/pjullrich/pushin/pulls/9/comments/1/replies", '{"body":"done"}'],
    ]);
  });

  it("refuses a pull request with more inline comments than it lists", async () => {
    const fetch = serve(
      at(`${REPO}/pulls/9`, () => pull),
      (url) =>
        url.pathname.endsWith("/pulls/9/comments")
          ? Response.json([inline(Number(url.searchParams.get("page")))], {
              headers: { link: `<${REPO}/pulls/9/comments?page=next>; rel="next"` },
            })
          : undefined,
    );

    await expect(provider().threads.list({ ...tracker, number: 9 })).rejects.toMatchObject({
      status: 413,
      platform: "pushin",
      message: "Pull request #9 has more than 2000 inline comments",
    });
    expect(urls(fetch).filter((url) => url.includes("/comments"))).toHaveLength(20);
  });
});

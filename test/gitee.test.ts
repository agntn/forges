/**
 * Gitee provider tests
 * Runs the real `forges/gitee` client against a stubbed fetch, so text issue keys, pages and
 * refusals go through the same parsing a live response does.
 */

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { GiteeProvider } from "../src/providers/gitee.ts";
import { NotFoundError, RateLimitError } from "../src/errors.ts";

const API = "https://gitee.com/api/v5";
const REPO = `${API}/repos/openharmony/docs`;
const SHA = "b84779874332bd7c2afee0ca3875494fa4793f1f";
const docs = { owner: "openharmony", repo: "docs" };

type Route = (url: URL, init: RequestInit) => Response | undefined;

/* openharmony/docs as the live API returned it on 2026-11-15, trimmed. */
const repository = {
  id: 10919030,
  full_name: "openharmony/docs",
  path: "docs",
  name: "docs",
  namespace: { path: "openharmony" },
  owner: { id: 7928036, login: "openharmony_admin" },
  description: "OpenHarmony documentation | OpenHarmony开发者文档",
  private: false,
  fork: false,
  html_url: "https://gitee.com/openharmony/docs.git",
  ssh_url: "git@gitee.com:openharmony/docs.git",
  default_branch: "master",
};

/* openharmony/docs issue ICK440 as the live API returned it on 2026-11-15, trimmed. */
const issue = {
  id: 21093840,
  number: "ICK440",
  state: "open",
  title: "[文档更新自提单]: 元能力：删除限制说明",
  body: "### 文档更新涉及子系统模块\r\n\r\n元能力\r\n\r\n",
  user: { id: 1, login: "zhongshield", name: "zhangzezhong" },
  labels: [{ name: "SelfTracking", color: "20c22e" }],
  assignee: null,
  html_url: "https://gitee.com/openharmony/docs/issues/ICK440",
  created_at: "2025-07-04T18:57:32+08:00",
  updated_at: "2025-07-04T18:57:49+08:00",
  finished_at: null,
  comments: 1,
};

const comment = {
  id: 43631638,
  body: "感谢提交Issue！",
  user: { id: 2, login: "openharmony_ci" },
  created_at: "2025-07-04T18:57:48+08:00",
  updated_at: "2025-07-04T18:57:48+08:00",
};

function serve(...routes: Route[]) {
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    return Response.json({ message: "404 Not Found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function at(path: string, body: (url: URL) => unknown, headers: HeadersInit = {}): Route {
  return (url) =>
    url.pathname === new URL(path).pathname ? Response.json(body(url), { headers }) : undefined;
}

function urls(fetch: ReturnType<typeof serve>): string[] {
  return fetch.mock.calls.map(([input]) =>
    String(input instanceof Request ? input.url : input).replace(API, ""),
  );
}

function provider(): GiteeProvider {
  return new GiteeProvider({ token: "gitee-token" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GiteeProvider issues", () => {
  it("keeps the text key Gitee gives an issue", async () => {
    serve(at(`${REPO}/issues`, () => [issue], { total_count: "1", total_page: "1" }));

    const page = await provider().issues.list(docs);

    expect(page.items.map((item) => item.number)).toEqual(["ICK440"]);
  });

  it("reads one issue and its comments by that key", async () => {
    const fetch = serve(
      at(`${REPO}/issues/ICK440`, () => issue),
      at(`${REPO}/issues/ICK440/comments`, () => [comment], { total_count: "1" }),
    );
    const gitee = provider();

    const read = await gitee.issues.get({ ...docs, number: "ICK440" });
    const comments = await gitee.issues.listComments({ ...docs, number: "ICK440" });

    expect(read).toMatchObject({ number: "ICK440", state: "open", labels: ["SelfTracking"] });
    expect(comments.items.map((item) => item.author.login)).toEqual(["openharmony_ci"]);
    expect(urls(fetch)).toEqual([
      "/repos/openharmony/docs/issues/ICK440",
      "/repos/openharmony/docs/issues/ICK440/comments?page=1&per_page=30",
    ]);
  });

  it("refuses a key that is not letters and digits before any request", async () => {
    const fetch = serve();

    const refusal = provider().issues.get({ ...docs, number: "../pulls" });

    await expect(refusal).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps sub issues numeric, since they compare numbers", async () => {
    const fetch = serve();

    await expect(
      provider().issues.listSubIssues({ ...docs, number: "ICK440" }),
    ).rejects.toMatchObject({ status: 400, message: "Number must be a positive integer" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still wants a number for a pull request", async () => {
    const fetch = serve();

    await expect(
      provider().pullRequests.get({ ...docs, number: "ICK440" as never }),
    ).rejects.toMatchObject({ status: 400, message: "Number must be a positive integer" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("GiteeProvider repositories", () => {
  it("drops the second .git forges adds to the clone URL", async () => {
    serve(at(REPO, () => repository));

    const repo = await provider().repos.get(docs);

    expect(repo).toMatchObject({
      fullName: "openharmony/docs",
      defaultBranch: "master",
      cloneUrl: "https://gitee.com/openharmony/docs.git",
    });
  });

  it("reads a file at the commit the default branch resolves to", async () => {
    const fetch = serve(
      at(REPO, () => repository),
      at(`${REPO}/commits/master`, () => ({ sha: SHA })),
      at(`${REPO}/contents/README.md`, () => ({
        type: "file",
        name: "README.md",
        path: "README.md",
        size: 29,
        encoding: "base64",
        content: Buffer.from("# OpenHarmony Documentation\n").toString("base64"),
      })),
    );

    const file = await provider().repos.readContents(docs, { path: "README.md" });

    expect(file).toMatchObject({
      type: "file",
      sha: SHA,
      content: "# OpenHarmony Documentation\n",
    });
    expect(urls(fetch).at(-1)).toBe(`/repos/openharmony/docs/contents/README.md?ref=${SHA}`);
  });

  it("lists a directory and calls an empty listing off the root missing", async () => {
    serve(
      at(`${REPO}/contents/zh-cn`, () => [
        { type: "dir", name: "application-dev", path: "zh-cn/application-dev", size: null },
        { type: "file", name: "readme.md", path: "zh-cn/readme.md", size: 512 },
      ]),
      at(`${REPO}/contents/nope.md`, () => []),
    );
    const gitee = provider();

    const directory = await gitee.repos.readContents(docs, { path: "zh-cn", ref: SHA });
    const missing = gitee.repos.readContents(docs, { path: "nope.md", ref: SHA });

    expect(directory).toMatchObject({
      type: "directory",
      entries: [
        { name: "application-dev", type: "directory", size: null },
        { name: "readme.md", type: "file", size: 512 },
      ],
    });
    await expect(missing).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("GiteeProvider comparisons", () => {
  function commit(sha: string, date: string) {
    return {
      sha,
      commit: { message: `commit ${sha.slice(0, 4)}`, author: { name: "a", date } },
    };
  }

  it("lists the range oldest first and calls a capped one incomplete", async () => {
    serve(
      at(`${REPO}/compare/OpenHarmony-1.0...OpenHarmony-2.0-Canary`, () => ({
        merge_base_commit: { sha: "38b9c760b078c291d6267551778168f4a3153491" },
        commits: [
          commit("2".repeat(40), "2021-06-15T16:25:07+08:00"),
          commit("1".repeat(40), "2021-03-29T20:09:29+08:00"),
        ],
        files: [{ filename: "README.md", status: "modified", additions: 1, deletions: 0 }],
        truncated: true,
      })),
    );

    const comparison = await provider().commits.compare(docs, {
      base: "OpenHarmony-1.0",
      head: "OpenHarmony-2.0-Canary",
    });

    expect(comparison.items.map((item) => item.sha[0])).toEqual(["1", "2"]);
    expect(comparison).toMatchObject({
      mergeBaseSha: "38b9c760b078c291d6267551778168f4a3153491",
      files: [{ path: "README.md", status: "modified" }],
      filesComplete: null,
    });
  });
});

describe("GiteeProvider failures", () => {
  it("reads Gitee's plain-text 403 as a rate limit", async () => {
    serve(() => new Response("403 Forbidden (Rate Limit Exceeded)", { status: 403 }));

    await expect(provider().repos.get(docs)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("answers CI runs with a 501", async () => {
    serve();

    await expect(provider().ciRuns.list(docs)).rejects.toMatchObject({ status: 501 });
  });
});

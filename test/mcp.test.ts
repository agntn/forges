import { toolEffects } from "../packages/shared/tool-effects.ts";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError, RateLimitError } from "../src/errors.ts";
import { createMcpServer } from "../src/mcp.ts";
import { resetPinnedProviders } from "../src/tool-operations.ts";

const mocks = vi.hoisted(() => {
  const repos = { list: vi.fn(), get: vi.fn(), readContents: vi.fn() };
  const contributionTemplates = { list: vi.fn(), get: vi.fn() };
  const code = { search: vi.fn() };
  const ciRuns = { list: vi.fn(), listJobs: vi.fn(), readJobLog: vi.fn() };
  const commits = { search: vi.fn(), list: vi.fn(), get: vi.fn(), readPatch: vi.fn() };
  const releases = { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() };
  const issues = { list: vi.fn(), search: vi.fn(), get: vi.fn(), create: vi.fn() };
  const pullRequests = {
    list: vi.fn(),
    listFiles: vi.fn(),
    listChecks: vi.fn(),
    listReviews: vi.fn(),
    getReview: vi.fn(),
    search: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
  };
  const users = { get: vi.fn(), authenticated: vi.fn() };
  const threads = {
    list: vi.fn(),
    get: vi.fn(),
    reply: vi.fn(),
    resolve: vi.fn(),
    unresolve: vi.fn(),
  };
  const provider = {
    repos,
    contributionTemplates,
    code,
    ciRuns,
    commits,
    releases,
    issues,
    pullRequests,
    users,
    threads,
  };

  return {
    resolveToken: vi.fn(() => ({ token: "test-token", source: "env" as const })),
    createProvider: vi.fn(() => provider),
    repos,
    contributionTemplates,
    code,
    ciRuns,
    commits,
    releases,
    issues,
    pullRequests,
    users,
    threads,
  };
});

vi.mock("../src/index.ts", () => ({
  resolveToken: mocks.resolveToken,
  createProvider: mocks.createProvider,
}));

const toolNames = [
  "forges_repos_list",
  "forges_repos_get",
  "forges_repos_contents",
  "forges_contribution_templates_list",
  "forges_contribution_templates_get",
  "forges_code_search",
  "forges_ci_runs_list",
  "forges_ci_jobs_list",
  "forges_ci_jobs_log",
  "forges_commits_search",
  "forges_commits_list",
  "forges_commits_get",
  "forges_commits_patch",
  "forges_releases_list",
  "forges_releases_get",
  "forges_releases_create",
  "forges_releases_update",
  "forges_issues_list",
  "forges_issues_search",
  "forges_issues_get",
  "forges_issues_comments",
  "forges_issues_comments_get",
  "forges_issues_comments_create",
  "forges_issues_create",
  "forges_pull_requests_list",
  "forges_pull_requests_search_global",
  "forges_pull_requests_search",
  "forges_pull_requests_get",
  "forges_pull_requests_files",
  "forges_pull_requests_checks",
  "forges_pull_requests_reviews",
  "forges_pull_requests_reviews_get",
  "forges_pull_requests_comments",
  "forges_pull_requests_comments_get",
  "forges_pull_requests_comments_create",
  "forges_pull_requests_create",
  "forges_pull_requests_update",
  "forges_users_get",
  "forges_users_authenticated",
  "forges_auth_reload",
  "forges_threads_list",
  "forges_threads_get",
  "forges_threads_reply",
  "forges_threads_resolve",
  "forges_threads_unresolve",
  "forges_local_inspect",
  "forges_local_merge_verify",
];

const writingTools = new Set([
  "forges_issues_create",
  "forges_issues_comments_create",
  "forges_pull_requests_comments_create",
  "forges_pull_requests_create",
  "forges_pull_requests_update",
  "forges_releases_create",
  "forges_releases_update",
  "forges_auth_reload",
  "forges_threads_reply",
  "forges_threads_resolve",
  "forges_threads_unresolve",
]);

const repository = {
  id: "1",
  name: "forges",
  fullName: "agntn/forges",
  owner: { login: "agntn" },
  private: false,
  defaultBranch: "main",
};

const openConnections: Array<{ close(): Promise<void> }> = [];

async function connectTestClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "forges-test", version: "1.0.0" });
  openConnections.push(client, server);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function text(content: unknown): string {
  return (content as Array<{ type: string; text?: string }>)
    .map((item) => (item.type === "text" ? (item.text ?? "") : ""))
    .join("");
}

beforeEach(() => {
  // resetAllMocks, per AGENTS.md: it drops each test's own stub while keeping the
  // vi.fn(impl) factory, so a rejection armed by one test cannot reach the next.
  vi.resetAllMocks();
  // The provider is pinned per platform for the process, so one case's pin would
  // otherwise decide whether the next one resolves a credential at all.
  resetPinnedProviders();
  vi.stubEnv("FORGES_GITHUB_BASE_URL", undefined);
  vi.stubEnv("FORGES_GITLAB_BASE_URL", undefined);
  vi.stubEnv("FORGES_GITEA_BASE_URL", undefined);
});

afterEach(async () => {
  await Promise.all(openConnections.splice(0).map((connection) => connection.close()));
  vi.unstubAllEnvs();
});

describe("forges MCP server", () => {
  it("keeps documentation tool counts aligned with discovery", async () => {
    const client = await connectTestClient();
    const { tools } = await client.listTools();
    const pages = [
      {
        path: "../README.md",
        claims: [
          /Four forges, ten resources, (\d+) agent tools\./,
          /\*\*(\d+) tools, three surfaces\.\*\*/,
          /MCP, Pi and OMP all hit the same (\d+) tools\./,
        ],
      },
      {
        path: "../docs/content/1.guide/01.index.md",
        claims: [/\[Agents\]\(\/guide\/agents\): (\d+) tools over MCP, Pi and OMP\./],
      },
      {
        path: "../docs/content/1.guide/10.agents.md",
        claims: [/description: The same (\d+) tools over MCP/, /^## (\d+) tools, three surfaces$/m],
      },
      {
        path: "../docs/app/components/content/LandingHome.vue",
        claims: [/value: "(\d+)", label: "agent tools"/, /title="(\d+) tools, three hosts"/],
      },
    ];
    for (const { path, claims } of pages) {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      for (const variant of [source, source.replaceAll("Seven tools write", "7 tools write")]) {
        for (const claim of claims) {
          const match = variant.match(claim);
          expect(match, `${path}: ${claim}`).not.toBeNull();
          expect(Number(match?.[1]), `${path}: ${claim}`).toBe(tools.length);
        }
      }
    }
  });

  it("advertises the complete tool set and marks the writing tools as writes", async () => {
    const client = await connectTestClient();

    const response = await client.listTools();

    expect(client.getServerVersion()).toMatchObject({
      name: "forges",
      title: "Forges",
      websiteUrl: "https://github.com/agntn/forges",
    });
    expect(response.tools.map((tool) => tool.name)).toEqual(toolNames);
    expect(response.tools.map((tool) => tool.name).sort()).toEqual(Object.keys(toolEffects).sort());
    for (const tool of response.tools) {
      expect(tool.annotations).toMatchObject({
        title: tool.title,
        readOnlyHint: !writingTools.has(tool.name),
        idempotentHint: ![
          "forges_issues_create",
          "forges_issues_comments_create",
          "forges_pull_requests_create",
          "forges_pull_requests_comments_create",
          "forges_releases_create",
          "forges_threads_reply",
          "forges_auth_reload",
        ].includes(tool.name),
        // A release or pull-request edit replaces the text that was there; nothing else overwrites.
        destructiveHint:
          tool.name === "forges_releases_update" || tool.name === "forges_pull_requests_update",
        openWorldHint: !tool.name.startsWith("forges_local_"),
      });
      expect(tool.title).not.toBe(tool.name);
    }
    // Creating the same issue twice leaves two behind; resolving twice leaves one thread resolved.
    expect(
      response.tools.find((tool) => tool.name === "forges_issues_create")?.annotations,
    ).toMatchObject({ idempotentHint: false });
    expect(
      response.tools.find((tool) => tool.name === "forges_threads_resolve")?.annotations,
    ).toMatchObject({ idempotentHint: true });
    expect(
      response.tools.find((tool) => tool.name === "forges_auth_reload")?.annotations,
    ).toMatchObject({ readOnlyHint: false, idempotentHint: false });
  });

  it("exposes only supported platforms and no credential or endpoint parameters", async () => {
    const client = await connectTestClient();

    const response = await client.listTools();

    expect(response.tools[0]?.inputSchema).toMatchObject({
      type: "object",
      required: ["owner"],
      properties: {
        platform: { enum: ["github", "gitlab", "gitea"], default: "github" },
      },
    });
    expect(
      response.tools.find((tool) => tool.name === "forges_repos_get")?.inputSchema,
    ).toMatchObject({ required: ["repo"] });
    for (const tool of response.tools) {
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/token|baseURL/u);
    }
  });

  it("accepts a repository written as one owner/name slug, on the default platform", async () => {
    mocks.repos.get.mockResolvedValue(repository);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_repos_get",
      arguments: { repo: "agntn/forges" },
    });

    expect(response.isError).not.toBe(true);
    expect(mocks.repos.get).toHaveBeenCalledWith("agntn", "forges");
  });

  it("reports an ambiguous repository as a tool error the model can act on", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_repos_get",
      arguments: { owner: "agntn", repo: "oritwoen/forges" },
    });

    expect(response.isError).toBe(true);
    expect(text(response.content)).toContain("Ambiguous repository");
  });

  it("answers with the normalized repository from the shared operation", async () => {
    mocks.repos.get.mockResolvedValue(repository);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_repos_get",
      arguments: { platform: "github", owner: "agntn", repo: "forges" },
    });

    expect(mocks.createProvider).toHaveBeenCalledWith("github", { token: "test-token" });
    expect(mocks.repos.get).toHaveBeenCalledWith("agntn", "forges");
    expect(response.isError).not.toBe(true);
    expect(JSON.parse(text(response.content))).toEqual({
      platform: "github",
      result: repository,
    });
    // Details never reach an MCP client, so the unbounded payload stays out of the result.
    expect(response.structuredContent).toBeUndefined();
  });

  it("lists contribution-template metadata and reads one body by its returned key", async () => {
    const summary = {
      kind: "issue",
      key: "agntn/.github:.github/ISSUE_TEMPLATE/bug.yml",
      name: "bug",
      scope: "owner",
      inherited: true,
      sourceRepository: "agntn/.github",
      sourcePath: ".github/ISSUE_TEMPLATE/bug.yml",
      sourceRef: "main",
    };
    mocks.contributionTemplates.list.mockResolvedValue({
      items: [summary],
      totalCount: 1,
      hasNextPage: false,
    });
    mocks.contributionTemplates.get.mockResolvedValue({ ...summary, content: "body: []\n" });
    const client = await connectTestClient();

    const listed = await client.callTool({
      name: "forges_contribution_templates_list",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        kind: "issue",
        page: 1,
        perPage: 10,
      },
    });
    const read = await client.callTool({
      name: "forges_contribution_templates_get",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        kind: "issue",
        key: summary.key,
      },
    });

    expect(mocks.contributionTemplates.list).toHaveBeenCalledWith("agntn", "forges", "issue", {
      page: 1,
      perPage: 10,
    });
    expect(mocks.contributionTemplates.get).toHaveBeenCalledWith(
      "agntn",
      "forges",
      "issue",
      summary.key,
    );
    expect(text(listed.content)).not.toContain("body: []");
    expect(text(read.content)).toContain("body: []");
  });

  it("searches code through the shared operation", async () => {
    const search = {
      items: [
        {
          repository: "agntn/forges",
          path: "src/provider.ts",
          url: "https://github.com/agntn/forges/blob/main/src/provider.ts",
        },
      ],
      totalCount: 1,
      incomplete: false,
      hasNextPage: false,
    };
    mocks.code.search.mockResolvedValue(search);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_code_search",
      arguments: {
        platform: "github",
        query: "Provider",
        owner: "agntn",
        repo: "forges",
        page: 2,
        perPage: 10,
      },
    });

    expect(mocks.code.search).toHaveBeenCalledWith("Provider", {
      owner: "agntn",
      repo: "forges",
      page: 2,
      perPage: 10,
    });
    expect(JSON.parse(text(response.content))).toEqual({ platform: "github", result: search });
  });

  it("explains commit search pagination and partial results in discovery", async () => {
    const client = await connectTestClient();
    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === "forges_commits_search");
    expect(tool?.description).toContain("follow nextPage while hasNextPage is true");
    expect(tool?.description).toContain("incomplete means the search is known to be partial");
    expect(tool?.description).toContain("narrow the query");
  });

  it("searches commits with completeness metadata through the shared operation", async () => {
    const search = {
      items: [],
      totalCount: 1200,
      incomplete: true,
      resultLimit: 1000,
      hasNextPage: false,
    };
    mocks.commits.search.mockResolvedValue(search);
    const client = await connectTestClient();
    const response = await client.callTool({
      name: "forges_commits_search",
      arguments: {
        platform: "github",
        query: "author:octocat",
        owner: "other",
        page: 2,
        perPage: 10,
      },
    });
    expect(mocks.commits.search).toHaveBeenCalledWith("author:octocat", {
      owner: "other",
      repo: undefined,
      page: 2,
      perPage: 10,
    });
    expect(JSON.parse(text(response.content))).toMatchObject({
      platform: "github",
      result: search,
    });
  });

  it("lists CI runs through the shared operation", async () => {
    const runs = {
      items: [
        {
          id: "9876",
          branch: "main",
          revision: "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38",
          status: "completed",
          conclusion: "success",
          url: "https://github.com/agntn/forges/actions/runs/9876",
        },
      ],
      hasNextPage: false,
    };
    mocks.ciRuns.list.mockResolvedValue(runs);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_ci_runs_list",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        branch: "main",
        page: 2,
        perPage: 10,
      },
    });

    expect(mocks.ciRuns.list).toHaveBeenCalledWith("agntn", "forges", {
      branch: "main",
      page: 2,
      perPage: 10,
    });
    expect(JSON.parse(text(response.content))).toEqual({ platform: "github", result: runs });
  });

  it("lists CI jobs and reads a job log through the shared operations", async () => {
    const jobs = { items: [{ id: "105912189006", conclusion: "failure" }], hasNextPage: false };
    const log = {
      jobId: "105912189006",
      name: "test",
      status: "completed",
      conclusion: "failure",
      started: true,
      logComplete: true,
      content: "--- step 10 Test: failure\n##[error]Process completed with exit code 1.\n",
      offset: 0,
      nextOffset: null,
      truncated: false,
      length: 72,
    };
    mocks.ciRuns.listJobs.mockResolvedValue(jobs);
    mocks.ciRuns.readJobLog.mockResolvedValue(log);
    const client = await connectTestClient();

    const listed = await client.callTool({
      name: "forges_ci_jobs_list",
      arguments: { repo: "agntn/forges", runId: "35448775016", perPage: 10 },
    });
    const read = await client.callTool({
      name: "forges_ci_jobs_log",
      arguments: { repo: "agntn/forges", jobId: "105912189006", offset: 20, maxChars: 1000 },
    });

    expect(mocks.ciRuns.listJobs).toHaveBeenCalledWith("agntn", "forges", "35448775016", {
      page: undefined,
      perPage: 10,
    });
    expect(mocks.ciRuns.readJobLog).toHaveBeenCalledWith("agntn", "forges", "105912189006", {
      offset: 20,
      maxChars: 1000,
    });
    expect(JSON.parse(text(listed.content))).toEqual({ platform: "github", result: jobs });
    expect(JSON.parse(text(read.content))).toEqual({ platform: "github", result: log });
  });

  it("lists commit summaries through the shared operation", async () => {
    const commits = {
      items: [
        {
          sha: "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38",
          message: "feat: list commit history",
          author: { name: "Ori", email: "ori@example.com", date: "2026-08-29T10:00:00Z" },
          committer: { name: "Ori", email: "ori@example.com", date: "2026-08-29T10:00:00Z" },
          parents: ["parent"],
          url: "https://github.com/agntn/forges/commit/cb9d4e5",
        },
      ],
      hasNextPage: false,
    };
    mocks.commits.list.mockResolvedValue(commits);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_commits_list",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        ref: "main",
        path: "src/provider.ts",
        since: "2026-08-01T00:00:00Z",
        until: "2026-08-29T23:59:59Z",
        page: 2,
        perPage: 10,
      },
    });

    expect(mocks.commits.list).toHaveBeenCalledWith("agntn", "forges", {
      ref: "main",
      path: "src/provider.ts",
      since: "2026-08-01T00:00:00Z",
      until: "2026-08-29T23:59:59Z",
      page: 2,
      perPage: 10,
    });
    expect(JSON.parse(text(response.content))).toMatchObject({
      platform: "github",
      result: commits,
    });
  });

  it("cuts commit messages to their subject line in list and search output", async () => {
    const identity = { name: "Ori", email: "ori@example.com", date: "2026-08-29T10:00:00Z" };
    const row = (sha: string, message: string) => ({
      sha,
      message,
      author: identity,
      committer: identity,
      parents: ["parent"],
      url: `https://github.com/agntn/forges/commit/${sha}`,
    });
    const body = "Explain the change.\n".repeat(400);
    const longLine = "y".repeat(5000);
    mocks.commits.list.mockResolvedValue({
      items: [
        row("a1", `feat: bound messages\r\n\r\n${body}Co-authored-by: A <a@example.com>`),
        row("b2", longLine),
        row("c3", "\nfix: keep short messages\n"),
      ],
      hasNextPage: false,
    });
    mocks.commits.search.mockResolvedValue({
      items: [{ ...row("d4", `chore: release\n\n${body}`), repository: "agntn/forges" }],
      totalCount: 1,
      incomplete: false,
      resultLimit: 1000,
      hasNextPage: false,
    });
    const client = await connectTestClient();

    const listed = text(
      (
        await client.callTool({
          name: "forges_commits_list",
          arguments: { owner: "agntn", repo: "forges" },
        })
      ).content,
    );
    const searched = text(
      (
        await client.callTool({
          name: "forges_commits_search",
          arguments: { query: "author:oritwoen" },
        })
      ).content,
    );

    expect(listed).not.toContain("Explain the change.");
    expect(listed).not.toContain("Co-authored-by");
    expect(searched).not.toContain("Explain the change.");
    const list = JSON.parse(listed);
    expect(list.result.items.map((item: { message: string }) => item.message)).toEqual([
      "feat: bound messages",
      "y".repeat(200),
      "fix: keep short messages",
    ]);
    expect(
      list.result.items.map((item: { messageTruncated?: true }) => item.messageTruncated),
    ).toEqual([true, true, undefined]);
    expect(list.note).toContain("forges_commits_get");
    const search = JSON.parse(searched);
    expect(search.result.items[0]).toMatchObject({
      message: "chore: release",
      messageTruncated: true,
      repository: "agntn/forges",
    });
    expect(search.result.totalCount).toBe(1);
    expect(search.note).toContain("forges_commits_get");
  });

  it("gets one commit through the shared operation", async () => {
    const commit = {
      sha: "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38",
      message: `fix: preserve commit metadata\n\n${"Body line.\n".repeat(50)}`,
      author: { name: "Ori", email: "ori@example.com", date: "2026-08-29T10:00:00Z" },
      committer: { name: "Ori", email: "ori@example.com", date: "2026-08-29T10:00:00Z" },
      parents: ["parent"],
      url: "https://github.com/agntn/forges/commit/cb9d4e5",
      files: [{ path: "src/provider.ts", status: "modified", additions: 12, deletions: 3 }],
      filesComplete: true,
    };
    mocks.commits.get.mockResolvedValue(commit);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_commits_get",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        sha: commit.sha,
      },
    });

    expect(mocks.commits.get).toHaveBeenCalledWith("agntn", "forges", commit.sha);
    expect(JSON.parse(text(response.content))).toEqual({ platform: "github", result: commit });
  });

  it("reads repository contents through the shared operation", async () => {
    const contents = {
      type: "file",
      path: "README.md",
      sha: "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38",
      size: 8,
      binary: false,
      content: "# Hello\n",
      offset: 0,
      nextOffset: null,
      truncated: false,
    };
    mocks.repos.readContents.mockResolvedValue(contents);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_repos_contents",
      arguments: { repo: "agntn/forges", path: "README.md", ref: "v0.3.3", maxChars: 1000 },
    });

    expect(mocks.repos.readContents).toHaveBeenCalledWith("agntn", "forges", "README.md", {
      ref: "v0.3.3",
      offset: undefined,
      maxChars: 1000,
    });
    expect(JSON.parse(text(response.content))).toEqual({ platform: "github", result: contents });
  });

  it("reads bounded commit patches through the shared operation", async () => {
    const patch = {
      sha: "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38",
      path: "src/provider.ts",
      content: "@@ -1 +1 @@\n-old\n+new\n",
      offset: 20,
      nextOffset: null,
      truncated: false,
      filesComplete: true,
      states: { included: 1, binary: 0, unavailable: 0 },
    };
    mocks.commits.readPatch.mockResolvedValue(patch);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_commits_patch",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        sha: patch.sha,
        path: patch.path,
        offset: 20,
        maxChars: 1000,
      },
    });

    expect(mocks.commits.readPatch).toHaveBeenCalledWith("agntn", "forges", patch.sha, {
      path: patch.path,
      offset: 20,
      maxChars: 1000,
    });
    expect(JSON.parse(text(response.content))).toEqual({ platform: "github", result: patch });
  });

  it("lists pull-request changed files through the shared operation", async () => {
    const files = {
      items: [
        {
          path: "src/provider.ts",
          status: "modified",
          additions: 12,
          deletions: 3,
        },
      ],
      hasNextPage: false,
    };
    mocks.pullRequests.listFiles.mockResolvedValue(files);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_pull_requests_files",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        number: 53,
        page: 2,
        perPage: 10,
      },
    });

    expect(mocks.pullRequests.listFiles).toHaveBeenCalledWith("agntn", "forges", 53, {
      page: 2,
      perPage: 10,
    });
    expect(JSON.parse(text(response.content))).toEqual({ platform: "github", result: files });
  });

  it("lists pull-request checks through the shared operation", async () => {
    const checks = {
      items: [
        {
          id: "6001",
          name: "test",
          status: "completed",
          conclusion: "success",
          url: "https://github.com/agntn/forges/runs/6001",
        },
      ],
      hasNextPage: false,
    };
    mocks.pullRequests.listChecks.mockResolvedValue(checks);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_pull_requests_checks",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        number: 53,
        page: 2,
        perPage: 10,
      },
    });

    expect(mocks.pullRequests.listChecks).toHaveBeenCalledWith("agntn", "forges", 53, {
      page: 2,
      perPage: 10,
    });
    expect(JSON.parse(text(response.content))).toEqual({ platform: "github", result: checks });
  });

  it("waits for pull-request checks to conclude instead of reporting their current state", async () => {
    const concluded = {
      items: [
        {
          id: "6001",
          name: "test",
          status: "completed",
          conclusion: "success",
          url: "https://github.com/agntn/forges/runs/6001",
        },
      ],
      hasNextPage: false,
    };
    mocks.pullRequests.listChecks.mockResolvedValue(concluded);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_pull_requests_checks",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        number: 53,
        waitSeconds: 30,
      },
    });

    expect(mocks.pullRequests.listChecks).toHaveBeenCalledWith("agntn", "forges", 53, {
      page: 1,
      perPage: undefined,
    });
    const payload = JSON.parse(text(response.content));
    expect(payload.result.items).toEqual(concluded.items);
    expect(payload.result.wait).toMatchObject({ settled: true, polls: 1, pending: [] });
    expect(payload.note).toBeUndefined();
  });

  it("rejects a wait budget outside the accepted range", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_pull_requests_checks",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        number: 53,
        waitSeconds: 0,
      },
    });

    expect(response.isError).toBe(true);
    expect(text(response.content)).toContain("/waitSeconds");
    expect(mocks.pullRequests.listChecks).not.toHaveBeenCalled();
  });

  it("lists pull-request reviews with truncated bodies", async () => {
    const review = {
      id: "5234466503",
      state: "changes_requested",
      body: Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n"),
      author: { login: "coderabbitai[bot]" },
      revision: "16d62fd354a4b1c2f5b1a8f68b8b75623b2f9d1e",
      submittedAt: "2026-09-17T10:42:16Z",
      url: "https://github.com/agntn/forges/pull/107#pullrequestreview-5234466503",
    };
    mocks.pullRequests.listReviews.mockResolvedValue({ items: [review], hasNextPage: false });
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_pull_requests_reviews",
      arguments: { platform: "github", owner: "agntn", repo: "forges", number: 107, perPage: 5 },
    });

    expect(mocks.pullRequests.listReviews).toHaveBeenCalledWith("agntn", "forges", 107, {
      page: undefined,
      perPage: 5,
    });
    const parsed = JSON.parse(text(response.content));
    expect(parsed.result.items[0]).toEqual({
      ...review,
      body: Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"),
    });
    expect(parsed.note).toContain("forges_pull_requests_reviews_get");
    expect(parsed.note).toContain("forges_threads_list");
    mocks.pullRequests.getReview.mockResolvedValue(review);
    const full = await client.callTool({
      name: "forges_pull_requests_reviews_get",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        number: 107,
        reviewId: review.id,
      },
    });
    expect(mocks.pullRequests.getReview).toHaveBeenCalledWith("agntn", "forges", 107, review.id);
    expect(JSON.parse(text(full.content))).toEqual({ platform: "github", result: review });
  });

  it("passes closingIssues through to the pull-request read", async () => {
    const closingIssues = [
      {
        number: 162,
        title: "Linked",
        state: "open",
        url: "https://github.com/agntn/forges/issues/162",
      },
    ];
    mocks.pullRequests.get.mockResolvedValue({ number: 170, closingIssues });
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_pull_requests_get",
      arguments: { owner: "agntn", repo: "forges", number: 170, closingIssues: true },
    });

    expect(mocks.pullRequests.get).toHaveBeenCalledWith("agntn", "forges", 170, {
      closingIssues: true,
    });
    expect(JSON.parse(text(response.content)).result.closingIssues).toEqual(closingIssues);
  });

  it("reloads the pinned credential and returns the authenticated profile", async () => {
    const user = { id: "1", login: "aeitwoen" };
    mocks.users.authenticated.mockResolvedValue(user);
    const client = await connectTestClient();

    await client.callTool({
      name: "forges_users_authenticated",
      arguments: { platform: "github" },
    });
    const response = await client.callTool({
      name: "forges_auth_reload",
      arguments: { platform: "github" },
    });

    expect(mocks.resolveToken).toHaveBeenCalledTimes(2);
    expect(mocks.createProvider).toHaveBeenCalledTimes(2);
    expect(JSON.parse(text(response.content))).toEqual({ platform: "github", result: user });
  });

  it("reads the self-hosted endpoint from the server environment, not from a tool argument", async () => {
    vi.stubEnv("FORGES_GITEA_BASE_URL", "https://gitea.example.com/api/v1");
    mocks.repos.get.mockResolvedValue(repository);
    const client = await connectTestClient();

    await client.callTool({
      name: "forges_repos_get",
      arguments: { platform: "gitea", owner: "agntn", repo: "forges" },
    });

    expect(mocks.createProvider).toHaveBeenCalledWith("gitea", {
      baseURL: "https://gitea.example.com/api/v1",
      token: "test-token",
    });
  });

  it("bounds list output by dropping issue bodies and saying where to read one", async () => {
    const body = "x".repeat(4096);
    mocks.issues.list.mockResolvedValue({
      items: [
        {
          id: "1",
          number: 1,
          title: "Bug",
          body,
          state: "open",
          labels: [],
          author: { login: "oritwoen" },
        },
      ],
      hasNextPage: false,
    });
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_issues_list",
      arguments: { platform: "github", owner: "agntn", repo: "forges", state: "open" },
    });

    const answer = text(response.content);
    expect(answer).not.toContain(body);
    expect(JSON.parse(answer)).toMatchObject({
      note: "Issue bodies are omitted from list output; use forges_issues_get to read one body.",
      result: { items: [{ number: 1, title: "Bug" }] },
    });
  });

  it("searches issues through the shared operation", async () => {
    mocks.issues.search.mockResolvedValue({
      items: [
        {
          id: "46",
          number: 46,
          title: "Add repository issue search",
          body: "large body",
          state: "open",
          labels: ["enhancement"],
          author: { login: "aeitwoen" },
          assignees: [],
          createdAt: "2026-08-27T00:00:00Z",
          updatedAt: "2026-08-27T00:00:00Z",
          url: "https://github.com/agntn/forges/issues/46",
        },
      ],
      incomplete: false,
      hasNextPage: false,
    });
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_issues_search",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        query: "issue search",
        state: "open",
      },
    });

    expect(mocks.issues.search).toHaveBeenCalledWith("agntn", "forges", "issue search", {
      page: undefined,
      perPage: undefined,
      state: "open",
    });
    const answer = text(response.content);
    expect(answer).not.toContain("large body");
    expect(JSON.parse(answer)).toMatchObject({
      note: "Issue bodies are omitted from search output; use forges_issues_get to read one body.",
      result: { items: [{ number: 46 }], incomplete: false },
    });
  });

  it("searches pull requests through the shared operation", async () => {
    mocks.pullRequests.search.mockResolvedValue({
      items: [
        {
          id: "82",
          number: 82,
          title: "Search repository issues",
          body: "large body",
          state: "closed",
          labels: [],
          author: { login: "aeitwoen" },
          assignees: [{ login: "aeitwoen" }],
          createdAt: "2026-08-28T18:17:14Z",
          updatedAt: "2026-08-28T18:18:58Z",
          url: "https://github.com/agntn/forges/pull/82",
          merged: true,
          draft: false,
        },
      ],
      incomplete: false,
      hasNextPage: false,
    });
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_pull_requests_search",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        query: "issue search",
        state: "closed",
      },
    });

    expect(mocks.pullRequests.search).toHaveBeenCalledWith("agntn", "forges", "issue search", {
      page: undefined,
      perPage: undefined,
      state: "closed",
    });
    const answer = text(response.content);
    expect(answer).not.toContain("large body");
    expect(JSON.parse(answer)).toMatchObject({
      note: "Pull-request bodies and revision details are omitted from search output; use forges_pull_requests_get to read one in full.",
      result: { items: [{ number: 82, merged: true }], incomplete: false },
    });
  });

  it("lists releases without their notes and says where to read one", async () => {
    const release = {
      id: "391667800",
      tag: "v0.3.1",
      name: "v0.3.1",
      body: "[compare changes](https://github.com/agntn/forges/compare/v0.3.0...v0.3.1)",
      draft: false,
      prerelease: false,
      author: { login: "aeitwoen" },
      createdAt: "2026-09-18T17:45:29Z",
      publishedAt: "2026-09-18T17:45:32Z",
      url: "https://github.com/agntn/forges/releases/tag/v0.3.1",
    };
    mocks.releases.list.mockResolvedValue({ items: [release], hasNextPage: false });
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_releases_list",
      arguments: { platform: "github", owner: "agntn", repo: "forges", perPage: 5 },
    });

    expect(mocks.releases.list).toHaveBeenCalledWith("agntn", "forges", {
      page: undefined,
      perPage: 5,
    });
    const parsed = JSON.parse(text(response.content));
    const { body: _body, ...summary } = release;
    expect(parsed.result.items[0]).toEqual(summary);
    expect(parsed.result.items[0]).not.toHaveProperty("body");
    expect(parsed.note).toContain("forges_releases_get");
  });

  it("reads one release by tag with its notes", async () => {
    const release = {
      id: "v1.118.0",
      tag: "v1.118.0",
      name: "v1.118.0",
      body: "## Changelog",
      draft: false,
      prerelease: false,
      author: { login: "service-code-review-glab" },
      createdAt: "2026-09-15T12:29:10.343Z",
      publishedAt: "2026-09-15T12:29:10.343Z",
      url: "https://gitlab.com/gitlab-org/cli/-/releases/v1.118.0",
    };
    mocks.releases.get.mockResolvedValue(release);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_releases_get",
      arguments: { platform: "gitlab", owner: "gitlab-org", repo: "cli", tag: "v1.118.0" },
    });

    expect(mocks.releases.get).toHaveBeenCalledWith("gitlab-org", "cli", "v1.118.0");
    expect(JSON.parse(text(response.content))).toEqual({ platform: "gitlab", result: release });
  });

  it("creates and updates a release through the shared operations", async () => {
    const release = {
      id: "945509",
      tag: "v0.17.0",
      name: "v0.17.0",
      body: "notes",
      draft: true,
      prerelease: false,
      author: { login: "aeitwoen" },
      createdAt: "2026-09-19T10:00:00Z",
      publishedAt: "",
      url: "https://gitea.com/gitea/tea/releases/tag/v0.17.0",
    };
    mocks.releases.create.mockResolvedValue(release);
    mocks.releases.update.mockResolvedValue({ ...release, body: "final notes", draft: false });
    const client = await connectTestClient();

    const created = await client.callTool({
      name: "forges_releases_create",
      arguments: {
        platform: "gitea",
        owner: "gitea",
        repo: "tea",
        tag: "v0.17.0",
        name: "v0.17.0",
        body: "notes",
        ref: "main",
        draft: true,
      },
    });
    const updated = await client.callTool({
      name: "forges_releases_update",
      arguments: {
        platform: "gitea",
        owner: "gitea",
        repo: "tea",
        tag: "v0.17.0",
        body: "final notes",
        draft: false,
      },
    });

    expect(mocks.releases.create).toHaveBeenCalledWith("gitea", "tea", {
      tag: "v0.17.0",
      name: "v0.17.0",
      body: "notes",
      ref: "main",
      draft: true,
      prerelease: undefined,
    });
    expect(mocks.releases.update).toHaveBeenCalledWith("gitea", "tea", "v0.17.0", {
      name: undefined,
      body: "final notes",
      draft: false,
      prerelease: undefined,
    });
    expect(JSON.parse(text(created.content))).toEqual({ platform: "gitea", result: release });
    expect(JSON.parse(text(updated.content)).result).toMatchObject({
      body: "final notes",
      draft: false,
    });
  });

  it("creates an issue through the shared operation", async () => {
    const issue = {
      id: "42",
      number: 42,
      title: "Bug",
      body: "Details",
      state: "open",
      assignees: [{ login: "triager" }],
    };
    mocks.issues.create.mockResolvedValue(issue);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_issues_create",
      arguments: {
        platform: "gitlab",
        owner: "agntn",
        repo: "forges",
        title: "Bug",
        body: "Details",
        labels: ["bug"],
        assignees: ["triager"],
      },
    });

    expect(mocks.issues.create).toHaveBeenCalledWith("agntn", "forges", {
      title: "Bug",
      body: "Details",
      labels: ["bug"],
      assignees: ["triager"],
    });
    expect(JSON.parse(text(response.content))).toEqual({ platform: "gitlab", result: issue });
  });

  it("returns the created object when requested assignees are missing", async () => {
    const issue = {
      id: "42",
      number: 42,
      title: "Bug",
      body: "Details",
      state: "open",
      assignees: [],
    };
    mocks.issues.create.mockResolvedValue(issue);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_issues_create",
      arguments: {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        title: "Bug",
        body: "Details",
        assignees: ["triager"],
      },
    });

    expect(JSON.parse(text(response.content))).toEqual({
      platform: "github",
      result: issue,
      note: "Creation succeeded, but requested assignees are missing: triager. Do not retry the create call; the result is the created object.",
    });
  });

  it("reports a failed operation as a tool error instead of a transport failure", async () => {
    mocks.repos.get.mockRejectedValue(new Error("Repository not found: agntn/nope"));
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_repos_get",
      arguments: { platform: "github", owner: "agntn", repo: "nope" },
    });

    expect(response.isError).toBe(true);
    expect(text(response.content)).toBe(
      "forges_repos_get failed: Repository not found: agntn/nope",
    );
  });

  it("keeps the configured endpoint out of the failure text", async () => {
    vi.stubEnv("FORGES_GITEA_BASE_URL", "https://git.internal.example:8443/api/v1");
    mocks.repos.get.mockRejectedValue(
      new NotFoundError(
        'Resource not found: [GET] "https://git.internal.example:8443/api/v1/repos/agntn/forges": 404 Not Found',
        "gitea",
      ),
    );
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_repos_get",
      arguments: { platform: "gitea", owner: "agntn", repo: "forges" },
    });

    const answer = text(response.content);
    expect(response.isError).toBe(true);
    expect(answer).not.toContain("git.internal.example");
    expect(answer).toBe("forges_repos_get failed: Resource not found: 404 Not Found");
  });

  it("names the retry window that the platform message cannot carry", async () => {
    mocks.issues.list.mockRejectedValue(
      new RateLimitError(
        'Rate limit exceeded: [GET] "https://api.github.com/repos/agntn/forges/issues": 429 Too Many Requests',
        60,
        "github",
      ),
    );
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_issues_list",
      arguments: { platform: "github", owner: "agntn", repo: "forges" },
    });

    expect(text(response.content)).toBe(
      "forges_issues_list failed: Rate limit exceeded: 429 Too Many Requests Retry after 60s.",
    );
  });

  it("escapes controls and directional formatting in error text", async () => {
    mocks.issues.list.mockRejectedValue(
      new Error("upstream\u001b]0;forged\u0007\nsecond\u0085\u2028\u202eflip"),
    );
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_issues_list",
      arguments: { platform: "github", owner: "agntn", repo: "forges" },
    });

    expect(text(response.content)).toBe(
      "forges_issues_list failed: upstream\\u001b]0;forged\\u0007\\u000asecond\\u0085\\u2028\\u202eflip",
    );
  });

  it("rejects arguments that miss the schema before reaching a provider", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_repos_list",
      arguments: { platform: "bitbucket", owner: "agntn" },
    });

    expect(response.isError).toBe(true);
    expect(text(response.content)).toContain("Invalid arguments at /platform");
    expect(mocks.createProvider).not.toHaveBeenCalled();
  });

  it("names an argument the schema does not know instead of dropping it", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "forges_issues_list",
      arguments: { platform: "github", owner: "agntn", repo: "forges", per_page: 100 },
    });

    expect(response.isError).toBe(true);
    expect(text(response.content)).toBe("Invalid arguments at /: unknown property per_page");
    expect(mocks.createProvider).not.toHaveBeenCalled();
  });

  it("names every unknown argument, more than TypeBox's error cap lists", async () => {
    const client = await connectTestClient();
    const stray = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [`stray_${index}`, index]),
    );

    const response = await client.callTool({
      name: "forges_issues_list",
      arguments: { platform: "github", owner: "agntn", repo: "forges", ...stray },
    });

    expect(response.isError).toBe(true);
    expect(text(response.content)).toBe(
      `Invalid arguments at /: unknown property ${Object.keys(stray).join(", ")}`,
    );
    expect(mocks.createProvider).not.toHaveBeenCalled();
  });

  it("rejects prototype property names as unknown tools", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({ name: "toString", arguments: {} });

    expect(response.isError).toBe(true);
    expect(text(response.content)).toBe("Unknown forges tool: toString");
  });

  it("escapes controls in unknown tool names", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({ name: "missing\nforged", arguments: {} });

    expect(response.isError).toBe(true);
    expect(text(response.content)).toBe("Unknown forges tool: missing\\u000aforged");
  });
});

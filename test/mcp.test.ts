import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError, RateLimitError } from "../src/errors.ts";
import { createMcpServer } from "../src/mcp.ts";
import { resetPinnedProviders } from "../src/tool-operations.ts";

const mocks = vi.hoisted(() => {
  const repos = { list: vi.fn(), get: vi.fn() };
  const contributionTemplates = { list: vi.fn(), get: vi.fn() };
  const code = { search: vi.fn() };
  const ciRuns = { list: vi.fn() };
  const commits = { list: vi.fn(), get: vi.fn() };
  const issues = { list: vi.fn(), search: vi.fn(), get: vi.fn(), create: vi.fn() };
  const pullRequests = {
    list: vi.fn(),
    listFiles: vi.fn(),
    listChecks: vi.fn(),
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
  "forges_contribution_templates_list",
  "forges_contribution_templates_get",
  "forges_code_search",
  "forges_ci_runs_list",
  "forges_commits_list",
  "forges_commits_get",
  "forges_issues_list",
  "forges_issues_search",
  "forges_issues_get",
  "forges_issues_comments",
  "forges_issues_comments_get",
  "forges_issues_create",
  "forges_pull_requests_list",
  "forges_pull_requests_search",
  "forges_pull_requests_get",
  "forges_pull_requests_files",
  "forges_pull_requests_checks",
  "forges_pull_requests_comments",
  "forges_pull_requests_comments_get",
  "forges_pull_requests_create",
  "forges_users_get",
  "forges_users_authenticated",
  "forges_auth_reload",
  "forges_threads_list",
  "forges_threads_get",
  "forges_threads_reply",
  "forges_threads_resolve",
  "forges_threads_unresolve",
];

const writingTools = new Set([
  "forges_issues_create",
  "forges_pull_requests_create",
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
  it("advertises the complete tool set and marks the writing tools as writes", async () => {
    const client = await connectTestClient();

    const response = await client.listTools();

    expect(response.tools.map((tool) => tool.name)).toEqual(toolNames);
    for (const tool of response.tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: !writingTools.has(tool.name),
        destructiveHint: false,
        openWorldHint: true,
      });
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
      required: ["platform", "owner"],
    });
    for (const tool of response.tools) {
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/token|baseURL/u);
    }
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
    expect(JSON.parse(text(response.content))).toEqual({ platform: "github", result: commits });
  });

  it("gets one commit through the shared operation", async () => {
    const commit = {
      sha: "cb9d4e5dc0f07fd9504b74e6ef58c37e9a32af38",
      message: "fix: preserve commit metadata",
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

  it("rejects prototype property names as unknown tools", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({ name: "toString", arguments: {} });

    expect(response.isError).toBe(true);
    expect(text(response.content)).toBe("Unknown forges tool: toString");
  });
});

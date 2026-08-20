import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError, RateLimitError } from "../src/errors.ts";
import { createMcpServer } from "../src/mcp.ts";

const mocks = vi.hoisted(() => {
  const repos = { list: vi.fn(), get: vi.fn() };
  const issues = { list: vi.fn(), get: vi.fn(), create: vi.fn() };
  const pullRequests = { list: vi.fn(), get: vi.fn(), create: vi.fn() };
  const users = { get: vi.fn(), authenticated: vi.fn() };
  const threads = {
    list: vi.fn(),
    get: vi.fn(),
    reply: vi.fn(),
    resolve: vi.fn(),
    unresolve: vi.fn(),
  };
  const provider = { repos, issues, pullRequests, users, threads };

  return {
    createProvider: vi.fn(() => provider),
    repos,
    issues,
    pullRequests,
    users,
    threads,
  };
});

vi.mock("../src/index.ts", () => ({ createProvider: mocks.createProvider }));

const toolNames = [
  "forges_repos_list",
  "forges_repos_get",
  "forges_issues_list",
  "forges_issues_get",
  "forges_issues_create",
  "forges_pull_requests_list",
  "forges_pull_requests_get",
  "forges_pull_requests_create",
  "forges_users_get",
  "forges_users_authenticated",
  "forges_threads_list",
  "forges_threads_get",
  "forges_threads_reply",
  "forges_threads_resolve",
  "forges_threads_unresolve",
];

const writingTools = new Set([
  "forges_issues_create",
  "forges_pull_requests_create",
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

    expect(mocks.createProvider).toHaveBeenCalledWith("github", undefined);
    expect(mocks.repos.get).toHaveBeenCalledWith("agntn", "forges");
    expect(response.isError).not.toBe(true);
    expect(JSON.parse(text(response.content))).toEqual({
      platform: "github",
      result: repository,
    });
    // Details never reach an MCP client, so the unbounded payload stays out of the result.
    expect(response.structuredContent).toBeUndefined();
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

  it("creates an issue through the shared operation", async () => {
    const issue = { id: "42", number: 42, title: "Bug", body: "Details", state: "open" };
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
      },
    });

    expect(mocks.issues.create).toHaveBeenCalledWith("agntn", "forges", {
      title: "Bug",
      body: "Details",
      labels: ["bug"],
    });
    expect(JSON.parse(text(response.content))).toEqual({ platform: "gitlab", result: issue });
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

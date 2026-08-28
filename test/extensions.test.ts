import * as OmpTypeBox from "@oh-my-pi/omptype/typebox";
import type {
  ExtensionAPI as OmpExtensionAPI,
  ExtensionContext as OmpExtensionContext,
  ToolDefinition as OmpToolDefinition,
} from "@oh-my-pi/pi-coding-agent";
import type {
  ExtensionAPI as PiExtensionAPI,
  ExtensionContext as PiExtensionContext,
  ToolDefinition as PiToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Value } from "typebox/value";

import forgesOmpExtension from "../packages/omp/extensions/forges.ts";
import forgesPiExtension from "../packages/pi/extensions/forges.ts";
import { resetPinnedProviders } from "../src/tool-operations.ts";

const mocks = vi.hoisted(() => {
  const repos = { list: vi.fn(), get: vi.fn() };
  const issues = { list: vi.fn(), get: vi.fn(), create: vi.fn(), listComments: vi.fn() };
  const pullRequests = { list: vi.fn(), get: vi.fn(), create: vi.fn(), listComments: vi.fn() };
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
    resolveToken: vi.fn(() => ({ token: "test-token", source: "env" as const })),
    createProvider: vi.fn(() => provider),
    repos,
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
  "forges_issues_list",
  "forges_issues_get",
  "forges_issues_comments",
  "forges_issues_comments_get",
  "forges_issues_create",
  "forges_pull_requests_list",
  "forges_pull_requests_get",
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

function registerPiTools(): Map<string, PiToolDefinition> {
  const tools = new Map<string, PiToolDefinition>();
  const api = {
    registerTool(tool: PiToolDefinition) {
      tools.set(tool.name, tool);
    },
  };
  forgesPiExtension(api as unknown as PiExtensionAPI);
  return tools;
}

function registerOmpTools(): { label: string | undefined; tools: Map<string, OmpToolDefinition> } {
  let label: string | undefined;
  const tools = new Map<string, OmpToolDefinition>();
  const api = {
    typebox: OmpTypeBox,
    setLabel(value: string) {
      label = value;
    },
    registerTool(tool: OmpToolDefinition) {
      tools.set(tool.name, tool);
    },
  };
  forgesOmpExtension(api as unknown as OmpExtensionAPI);
  return { label, tools };
}

function requirePiTool(tools: Map<string, PiToolDefinition>, name: string): PiToolDefinition {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Pi tool not registered: ${name}`);
  return tool;
}

function requireOmpTool(tools: Map<string, OmpToolDefinition>, name: string): OmpToolDefinition {
  const tool = tools.get(name);
  if (!tool) throw new Error(`OMP tool not registered: ${name}`);
  return tool;
}

function ompAccepts(tool: OmpToolDefinition, value: unknown): boolean {
  // OMP's host schema and the extension type package are structurally identical at this test seam.
  const schema = tool.parameters as unknown as OmpTypeBox.TSchema;
  return schema.safeParse(value).success;
}

const unusedPiContext = {} as PiExtensionContext;
const unusedOmpContext = {} as OmpExtensionContext;

beforeEach(() => {
  vi.clearAllMocks();
  resetPinnedProviders();
  vi.stubEnv("FORGES_GITHUB_BASE_URL", undefined);
  vi.stubEnv("FORGES_GITLAB_BASE_URL", undefined);
  vi.stubEnv("FORGES_GITEA_BASE_URL", undefined);
  mocks.repos.list.mockResolvedValue({ items: [], hasNextPage: false });
  mocks.issues.create.mockResolvedValue({
    id: "42",
    number: 42,
    title: "Bug",
    body: "Details",
    state: "open",
    labels: ["bug"],
    author: { login: "oritwoen" },
    assignees: [{ login: "triager" }],
    createdAt: "2026-08-18T00:00:00Z",
    updatedAt: "2026-08-18T00:00:00Z",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Forges Pi extension", () => {
  it("registers the complete tool set with self-identifying guidelines", () => {
    const tools = registerPiTools();

    expect([...tools.keys()]).toEqual(toolNames);
    for (const tool of tools.values()) {
      expect(tool.promptGuidelines).not.toHaveLength(0);
      for (const guideline of tool.promptGuidelines ?? []) expect(guideline).toContain(tool.name);
    }
  });

  it("exposes only supported platforms and no credential or endpoint parameters", () => {
    const tool = requirePiTool(registerPiTools(), "forges_repos_list");

    expect(Value.Check(tool.parameters, { platform: "github", owner: "agntn" })).toBe(true);
    expect(Value.Check(tool.parameters, { platform: "bitbucket", owner: "agntn" })).toBe(false);
    expect(JSON.stringify(tool.parameters)).not.toMatch(/token|baseURL/u);
  });

  it("executes repository listing through the shared provider operation", async () => {
    const tool = requirePiTool(registerPiTools(), "forges_repos_list");
    const result = await tool.execute(
      "test",
      { platform: "github", owner: "agntn", page: 2, perPage: 25 },
      undefined,
      undefined,
      unusedPiContext,
    );

    expect(mocks.createProvider).toHaveBeenCalledWith("github", { token: "test-token" });
    expect(mocks.repos.list).toHaveBeenCalledWith("agntn", {
      page: 2,
      perPage: 25,
      state: undefined,
    });
    expect(result.details).toEqual({
      platform: "github",
      result: { items: [], hasNextPage: false },
    });
  });

  it("reloads authentication through the shared operation", async () => {
    const user = { id: "1", login: "aeitwoen" };
    mocks.users.authenticated.mockResolvedValue(user);
    const tools = registerPiTools();

    await requirePiTool(tools, "forges_users_authenticated").execute(
      "test",
      { platform: "github" },
      undefined,
      undefined,
      unusedPiContext,
    );
    const result = await requirePiTool(tools, "forges_auth_reload").execute(
      "test",
      { platform: "github" },
      undefined,
      undefined,
      unusedPiContext,
    );

    expect(mocks.createProvider).toHaveBeenCalledTimes(2);
    expect(result.details.result).toEqual(user);
  });

  it.each([
    ["github", "FORGES_GITHUB_BASE_URL", "https://github.example.com/api/v3"],
    ["gitlab", "FORGES_GITLAB_BASE_URL", "https://gitlab.example.com/api/v4"],
    ["gitea", "FORGES_GITEA_BASE_URL", "https://gitea.example.com/api/v1"],
  ] as const)(
    "uses trusted local base URL configuration for %s without exposing it to the model",
    async (platform, envName, baseURL) => {
      vi.stubEnv(envName, baseURL);
      const tool = requirePiTool(registerPiTools(), "forges_repos_list");

      await tool.execute(
        "test",
        { platform, owner: "agntn" },
        undefined,
        undefined,
        unusedPiContext,
      );

      expect(mocks.createProvider).toHaveBeenCalledWith(platform, {
        baseURL,
        token: "test-token",
      });
      expect(JSON.stringify(tool.parameters)).not.toMatch(/baseURL/u);
    },
  );

  it("bounds model-facing issue and pull-request list output", async () => {
    const body = "x".repeat(65_536);
    const issues = Array.from({ length: 100 }, (_, index) => ({
      id: String(index + 1),
      number: index + 1,
      title: `Issue ${index + 1}`,
      body,
      state: "open",
      labels: ["bug"],
      author: { login: "oritwoen" },
      createdAt: "2026-08-18T00:00:00Z",
      updatedAt: "2026-08-18T00:00:00Z",
    }));
    expect(body.length * issues.length).toBeGreaterThan(6_000_000);
    mocks.issues.list.mockResolvedValue({ items: issues, hasNextPage: false });
    mocks.pullRequests.list.mockResolvedValue({
      items: issues.map((issue) => ({
        ...issue,
        sourceBranch: "feature",
        targetBranch: "main",
        merged: false,
        draft: false,
      })),
      hasNextPage: false,
    });

    const tools = registerPiTools();
    const calls = [
      requirePiTool(tools, "forges_issues_list"),
      requirePiTool(tools, "forges_pull_requests_list"),
    ];
    for (const tool of calls) {
      const result = await tool.execute(
        "test",
        { platform: "github", owner: "agntn", repo: "forges", perPage: 100 },
        undefined,
        undefined,
        unusedPiContext,
      );
      const text = result.content.find((part) => part.type === "text")?.text;
      expect(text?.length).toBeLessThan(100_000);
      expect(text).toContain("bodies are omitted");
      expect(JSON.stringify(result.details)).not.toContain(body);
    }
  });

  it("bounds model-facing review-thread list comment bodies", async () => {
    const body = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
    mocks.threads.list.mockResolvedValue({
      items: [
        {
          id: "PRRT_1",
          isResolved: false,
          isOutdated: false,
          path: "src/index.ts",
          line: 12,
          startLine: 10,
          comments: [
            {
              id: "9001",
              body,
              author: { login: "reviewer" },
              url: "https://example",
              createdAt: "2026-08-18T00:00:00Z",
            },
          ],
        },
      ],
      hasNextPage: false,
    });

    const result = await requirePiTool(registerPiTools(), "forges_threads_list").execute(
      "test",
      { platform: "github", owner: "agntn", repo: "forges", number: 31 },
      undefined,
      undefined,
      unusedPiContext,
    );
    const text = result.content.find((part) => part.type === "text")?.text;
    expect(text).toContain("truncated");
    expect(text).toContain("line 0");
    expect(text).not.toContain("line 20");
    expect(JSON.stringify(result.details)).not.toContain("line 20");
    expect(mocks.threads.list).toHaveBeenCalledWith("agntn", "forges", 31, {
      page: undefined,
      perPage: undefined,
      state: undefined,
    });
  });

  it("bounds model-facing discussion comment bodies and names the full read", async () => {
    const body = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
    const page = {
      items: [
        {
          id: "3001",
          body,
          author: { login: "commenter" },
          url: "https://example",
          createdAt: "2026-08-25T00:00:00Z",
          updatedAt: "2026-08-25T00:00:00Z",
        },
      ],
      hasNextPage: false,
    };
    mocks.issues.listComments.mockResolvedValue(page);
    mocks.pullRequests.listComments.mockResolvedValue(page);

    const tools = registerPiTools();
    for (const name of ["forges_issues_comments", "forges_pull_requests_comments"]) {
      const result = await requirePiTool(tools, name).execute(
        "test",
        { platform: "github", owner: "agntn", repo: "forges", number: 37 },
        undefined,
        undefined,
        unusedPiContext,
      );
      const text = result.content.find((part) => part.type === "text")?.text;
      expect(text).toContain("truncated");
      expect(text).toContain(`${name}_get`);
      expect(text).toContain("line 0");
      expect(text).not.toContain("line 20");
      expect(JSON.stringify(result.details)).not.toContain("line 20");
    }
  });
});

describe("Forges OMP extension", () => {
  it("registers the complete tool set under the Forges label", () => {
    const { label, tools } = registerOmpTools();

    expect(label).toBe("Forges");
    expect([...tools.keys()]).toEqual(toolNames);
  });

  it("keeps Pi and OMP parameter schemas aligned recursively", () => {
    const piTools = registerPiTools();
    const ompTools = registerOmpTools().tools;

    for (const name of toolNames) {
      const piTool = requirePiTool(piTools, name);
      const ompTool = requireOmpTool(ompTools, name);
      // OMP's host facade is the runtime owner of this schema and can emit canonical JSON Schema.
      const ompSchema = ompTool.parameters as unknown as OmpTypeBox.TSchema;
      const piSchema: unknown = JSON.parse(JSON.stringify(piTool.parameters));
      expect(ompSchema.toJsonSchema(), `${name} schema`).toEqual(piSchema);
    }

    const invalidNestedAssignee = {
      platform: "github",
      owner: "agntn",
      repo: "forges",
      title: "Bug",
      body: "Details",
      assignees: [""],
    };
    const piCreate = requirePiTool(piTools, "forges_issues_create");
    const ompCreate = requireOmpTool(ompTools, "forges_issues_create");
    expect(Value.Check(piCreate.parameters, invalidNestedAssignee)).toBe(false);
    expect(ompAccepts(ompCreate, invalidNestedAssignee)).toBe(false);

    const tooManyAssignees = {
      ...invalidNestedAssignee,
      assignees: Array.from({ length: 11 }, (_, index) => `user-${index}`),
    };
    expect(Value.Check(piCreate.parameters, tooManyAssignees)).toBe(false);
    expect(ompAccepts(ompCreate, tooManyAssignees)).toBe(false);
  });

  it("marks read operations read-only and mutations as writes", () => {
    const { tools } = registerOmpTools();
    const mutationTools: Record<string, true> = {
      forges_issues_create: true,
      forges_pull_requests_create: true,
      forges_auth_reload: true,
      forges_threads_reply: true,
      forges_threads_resolve: true,
      forges_threads_unresolve: true,
    };

    for (const tool of tools.values()) {
      expect(tool.approval).toBe(tool.name in mutationTools ? "write" : "read");
    }
  });

  it("uses the injected OMP schema facade without credential or endpoint parameters", () => {
    const tool = requireOmpTool(registerOmpTools().tools, "forges_repos_list");

    expect(ompAccepts(tool, { platform: "gitea", owner: "agntn" })).toBe(true);
    expect(ompAccepts(tool, { platform: "bitbucket", owner: "agntn" })).toBe(false);
    // OMP injects its runtime schema facade, whose object shape is exposed through checked IR.
    const schema = tool.parameters as unknown as OmpTypeBox.TSchema;
    if (schema.ir.k !== "object") throw new Error("Expected an OMP object schema");
    expect(schema.ir.props.map((property) => property.key)).toEqual([
      "platform",
      "owner",
      "page",
      "perPage",
    ]);
  });

  it("executes issue creation through the shared provider operation", async () => {
    const tool = requireOmpTool(registerOmpTools().tools, "forges_issues_create");
    const result = await tool.execute(
      "test",
      {
        platform: "gitlab",
        owner: "agntn",
        repo: "forges",
        title: "Bug",
        body: "Details",
        labels: ["bug"],
        assignees: ["triager"],
      },
      undefined,
      undefined,
      unusedOmpContext,
    );

    expect(mocks.createProvider).toHaveBeenCalledWith("gitlab", { token: "test-token" });
    expect(mocks.issues.create).toHaveBeenCalledWith("agntn", "forges", {
      title: "Bug",
      body: "Details",
      labels: ["bug"],
      assignees: ["triager"],
    });
    expect(result.details).toMatchObject({ platform: "gitlab", result: { number: 42 } });
  });
});

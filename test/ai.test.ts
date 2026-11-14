import { generateText, isStepCount, type ToolApprovalConfiguration } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { toolApproval, toolEffects } from "../extensions/shared/tool-effects.ts";
import { forgesAiTools } from "../src/ai.ts";

const mocks = vi.hoisted(() => {
  const issues = { get: vi.fn(), createComment: vi.fn() };
  return {
    issues,
    resolveToken: vi.fn(() => ({ token: "test-token", source: "env" as const })),
    createProvider: vi.fn(() => ({ issues })),
  };
});

vi.mock("../src/index.ts", () => ({
  resolveToken: mocks.resolveToken,
  createProvider: mocks.createProvider,
}));

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

/* A model that makes one tool call with the given input, then says it's done. */
function scriptedModel(toolName: string, input: Readonly<Record<string, unknown>>) {
  return new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          { type: "tool-call", toolCallId: "call-0", toolName, input: JSON.stringify(input) },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "done" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });
}

/* Runs one scripted call through generateText and hands back the parts of its first step. */
async function callThroughModel(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  approval?: ToolApprovalConfiguration<typeof forgesAiTools, unknown>,
): Promise<readonly { type: string }[]> {
  const result = await generateText({
    model: scriptedModel(toolName, input),
    tools: forgesAiTools,
    ...(approval ? { toolApproval: approval } : {}),
    stopWhen: isStepCount(2),
    prompt: "look at agntn/forges",
  });
  return result.steps[0]?.content ?? [];
}

const comment = { repo: "agntn/forges", number: 7, body: "Looks good." };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("forgesAiTools", () => {
  it("lists every forges tool under its MCP name", () => {
    expect(Object.keys(forgesAiTools).toSorted()).toEqual(Object.keys(toolEffects).toSorted());
  });

  it("asks before exactly the tools the status line marks as writes", () => {
    const asking = Object.entries(forgesAiTools)
      .filter(([, tool]) => tool.needsApproval === true)
      .map(([name]) => name)
      .toSorted();
    const writes = Object.keys(toolEffects)
      .filter((name) => toolApproval(name) === "write")
      .toSorted();
    expect(asking).toEqual(writes);
    expect(asking).toContain("forges_pull_requests_merge");
    expect(asking).not.toContain("forges_issues_get");
  });

  it("runs a read without asking", async () => {
    mocks.issues.get.mockResolvedValue({
      number: 7,
      title: "Merge button",
      body: "It merges.",
      state: "open",
    });
    const parts = await callThroughModel("forges_issues_get", { repo: "agntn/forges", number: 7 });
    expect(parts.map((part) => part.type)).toEqual(["tool-call", "tool-result"]);
    expect(mocks.issues.get).toHaveBeenCalledOnce();
  });

  it("stops a write at an approval request", async () => {
    const parts = await callThroughModel("forges_issues_comments_create", comment);
    expect(parts.map((part) => part.type)).toEqual(["tool-call", "tool-approval-request"]);
    expect(mocks.issues.createComment).not.toHaveBeenCalled();
  });

  it("lets the caller's toolApproval approve a write", async () => {
    mocks.issues.createComment.mockResolvedValue({ id: "1", body: "Looks good." });
    const parts = await callThroughModel("forges_issues_comments_create", comment, {
      forges_issues_comments_create: "approved",
    });
    expect(parts.map((part) => part.type)).toContain("tool-result");
    expect(mocks.issues.createComment).toHaveBeenCalledOnce();
  });
});

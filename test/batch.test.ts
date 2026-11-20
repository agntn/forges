import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { NotFoundError } from "../src/errors.ts";
import { createMcpServer } from "../src/mcp.ts";
import { resetPinnedProviders } from "../src/tool-operations.ts";
import { forgesCommands, forgesTools } from "../src/tools.ts";

const mocks = vi.hoisted(() => {
  const issues = { get: vi.fn() };
  const pullRequests = { get: vi.fn() };
  const threads = { get: vi.fn(), resolve: vi.fn(), unresolve: vi.fn() };
  const provider = { issues, pullRequests, threads };
  return {
    resolveToken: vi.fn(() => ({ token: "test-token", source: "env" as const })),
    createProvider: vi.fn(() => provider),
    issues,
    pullRequests,
    threads,
  };
});

vi.mock("../src/index.ts", () => ({
  resolveToken: mocks.resolveToken,
  createProvider: mocks.createProvider,
}));

const openConnections: Array<{ close(): Promise<void> }> = [];

async function connect(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "forges-batch-test", version: "1.0.0" });
  openConnections.push(client, server);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function call(name: string, args: Record<string, unknown>) {
  const response = await (await connect()).callTool({ name, arguments: args });
  const [part] = response.content as Array<{ type: string; text: string }>;
  return { isError: response.isError === true, text: part?.text ?? "" };
}

const issue = (number: number | string) => ({
  id: `id-${number}`,
  number,
  title: `Issue ${number}`,
  body: "x".repeat(30_000),
  state: "open",
});

const thread = (id: string, isResolved: boolean) => ({
  id,
  isResolved,
  isOutdated: false,
  path: "src/batch.ts",
  line: 1,
  startLine: null,
  comments: [{ id: "c1", body: "long review text" }],
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveToken.mockReturnValue({ token: "test-token", source: "env" });
  mocks.createProvider.mockReturnValue({
    issues: mocks.issues,
    pullRequests: mocks.pullRequests,
    threads: mocks.threads,
  });
  resetPinnedProviders();
});

afterEach(async () => {
  await Promise.all(openConnections.splice(0).map((connection) => connection.close()));
});

describe("batch keys", () => {
  it("reads one issue exactly as before", async () => {
    mocks.issues.get.mockResolvedValue(issue(391));
    const answer = await call("forges_issues_get", { repo: "agntn/forges", number: 391 });
    const parsed = JSON.parse(answer.text);
    expect(parsed.result.number).toBe(391);
    expect(parsed.result.body).toHaveLength(20_000);
    expect(Array.isArray(parsed.result)).toBe(false);
  });

  /* Issue 1 answers last, so the order comes from the input. */
  it("reads several issues in input order, a missing one as its own error", async () => {
    mocks.issues.get.mockImplementation(async ({ number }: { number: number }) => {
      if (number === 2) throw new NotFoundError("Issue not found: 2", { platform: "github" });
      if (number === 1) await new Promise((resolve) => setTimeout(resolve, 20));
      return issue(number);
    });
    const answer = await call("forges_issues_get", { repo: "agntn/forges", number: [1, 2, 3] });

    expect(answer.isError).toBe(false);
    const { result } = JSON.parse(answer.text);
    expect(result.map((item: { number: number }) => item.number)).toEqual([1, 2, 3]);
    expect(result[0].result.number).toBe(1);
    expect(result[1]).toEqual({ number: 2, error: "Issue not found: 2" });
    expect(result[2].result.number).toBe(3);
    expect(mocks.issues.get).toHaveBeenCalledTimes(3);
  });

  it("splits the body ceiling across a batch instead of multiplying it", async () => {
    mocks.issues.get.mockImplementation(async ({ number }: { number: number }) => issue(number));
    const numbers = Array.from({ length: 10 }, (_, index) => index + 1);
    const answer = await call("forges_issues_get", { repo: "agntn/forges", number: numbers });
    const { result } = JSON.parse(answer.text);
    expect(
      result.every((item: { result: { body: string } }) => item.result.body.length === 20_000),
    ).toBe(true);

    const greedy = await call("forges_issues_get", {
      repo: "agntn/forges",
      number: numbers,
      maxChars: 20_001,
    });
    expect(greedy.isError).toBe(true);
    expect(greedy.text).toContain("maxChars is at most 20000");
  });

  it("keeps a continuation to a single body", async () => {
    const answer = await call("forges_pull_requests_get", {
      repo: "agntn/forges",
      number: [1, 2],
      offset: 20_000,
      bodyHash: "0123456789abcdef",
    });
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("pass the single number they came with");
    expect(mocks.pullRequests.get).not.toHaveBeenCalled();
  });

  it("refuses an oversized or empty batch before any request", async () => {
    for (const number of [Array.from({ length: 11 }, (_, index) => index + 1), []]) {
      const answer = await call("forges_issues_get", { repo: "agntn/forges", number });
      expect(answer.isError).toBe(true);
    }
    expect(mocks.issues.get).not.toHaveBeenCalled();
    expect(mocks.createProvider).not.toHaveBeenCalled();
  });

  it("passes closingIssues to every pull request of a batch", async () => {
    mocks.pullRequests.get.mockImplementation(async ({ number }: { number: number }) => ({
      ...issue(number),
      closingIssues: [],
    }));
    await call("forges_pull_requests_get", {
      repo: "agntn/forges",
      number: [393, 397],
      closingIssues: true,
    });
    expect(mocks.pullRequests.get.mock.calls).toEqual([
      [{ owner: "agntn", repo: "forges", number: 393 }, { closingIssues: true }],
      [{ owner: "agntn", repo: "forges", number: 397 }, { closingIssues: true }],
    ]);
  });

  it("resolves several threads, keeps the resolved ones when one fails, and drops comments", async () => {
    mocks.threads.resolve.mockImplementation(
      async (_pull: unknown, { threadId }: { threadId: string }) => {
        if (threadId === "PRRT_b")
          throw new NotFoundError("Thread not found", { platform: "github" });
        return thread(threadId, true);
      },
    );
    const answer = await call("forges_threads_resolve", {
      repo: "agntn/forges",
      number: 398,
      threadId: ["PRRT_a", "PRRT_b", "PRRT_c"],
    });

    expect(answer.isError).toBe(false);
    const { result } = JSON.parse(answer.text);
    expect(result).toEqual(
      [
        {
          threadId: "PRRT_a",
          result: { ...thread("PRRT_a", true), comments: undefined, commentCount: 1 },
        },
        { threadId: "PRRT_b", error: "Thread not found" },
        {
          threadId: "PRRT_c",
          result: { ...thread("PRRT_c", true), comments: undefined, commentCount: 1 },
        },
      ].map((item) => JSON.parse(JSON.stringify(item))),
    );
    expect(mocks.threads.resolve).toHaveBeenCalledTimes(3);
  });

  it("reads a batch in parallel and writes it one thread at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    const tracked = async (_pull: unknown, { threadId }: { threadId: string }) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return thread(threadId, true);
    };
    mocks.threads.get.mockImplementation(tracked);
    mocks.threads.resolve.mockImplementation(tracked);
    const threadId = ["a", "b", "c"];

    await call("forges_threads_get", { repo: "a/b", number: 1, threadId });
    expect(peak).toBe(3);
    peak = 0;
    await call("forges_threads_resolve", { repo: "a/b", number: 1, threadId });
    expect(peak).toBe(1);
  });

  it("unresolves and reads threads in a batch too", async () => {
    mocks.threads.unresolve.mockImplementation(
      async (_pull: unknown, { threadId }: { threadId: string }) => thread(threadId, false),
    );
    mocks.threads.get.mockImplementation(
      async (_pull: unknown, { threadId }: { threadId: string }) => thread(threadId, true),
    );
    const reopened = JSON.parse(
      (await call("forges_threads_unresolve", { repo: "a/b", number: 1, threadId: ["x", "y"] }))
        .text,
    );
    expect(reopened.result.map((item: { threadId: string }) => item.threadId)).toEqual(["x", "y"]);
    const read = JSON.parse(
      (await call("forges_threads_get", { repo: "a/b", number: 1, threadId: ["x"] })).text,
    );
    expect(read.result[0].result.comments).toHaveLength(1);
  });

  it("keeps one plain word per key on the CLI", () => {
    const commands = new Map(forgesCommands().map((command) => [command.name, command]));
    expect([...commands.keys()].toSorted()).toEqual([
      "forges_issues_get",
      "forges_pull_requests_get",
      "forges_threads_get",
      "forges_threads_resolve",
      "forges_threads_unresolve",
    ]);
    const tools = new Map(forgesTools().map((tool) => [tool.name, tool]));
    for (const [name, command] of commands) {
      const key = name.startsWith("forges_threads_") ? "threadId" : "number";
      expect(JSON.stringify(command.input.properties[key])).not.toContain('"array"');
      expect(JSON.stringify(tools.get(name)?.input.properties[key])).toContain('"array"');
      expect(command.description).toBe(tools.get(name)?.description);
    }
  });
});

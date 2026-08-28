import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as OmpTypeBox from "@oh-my-pi/omptype/typebox";

const root = process.cwd();
const temporaryRoot = await mkdtemp(join(root, ".forges-packed-test-"));
const packageRoot = join(temporaryRoot, "package");
const environmentKeys = ["FORGES_GITHUB_BASE_URL", "GH_TOKEN", "GITHUB_TOKEN"];
const originalEnvironment = environmentKeys.map((key) => [key, process.env[key]]);
const expectedToolNames = [
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

async function assertDistributionFallback(extensionPath, api) {
  const moduleUrl = `${pathToFileURL(extensionPath).href}?packed=${Date.now()}`;
  const extension = await import(moduleUrl);
  const tools = new Map();
  extension.default({
    ...api,
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
  });

  assert.deepEqual([...tools.keys()], expectedToolNames);
  const tool = tools.get("forges_repos_get");
  assert(tool, "forges_repos_get was not registered");
  await assert.rejects(
    () =>
      tool.execute(
        "packed-test",
        { platform: "github", owner: "agntn", repo: "forges" },
        undefined,
        undefined,
        {},
      ),
    /Failed to parse URL/,
  );
}

/**
 * The MCP bundle is published too, and it is the only entry that carries the SDK
 * and typebox, so a chunk split or a missing dependency would surface here first.
 */
async function assertPackedMcpServer(root) {
  const moduleUrl = `${pathToFileURL(join(root, "dist/mcp.mjs")).href}?packed=${Date.now()}`;
  const { createMcpServer } = await import(moduleUrl);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "packed-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      expectedToolNames,
    );
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

process.env.FORGES_GITHUB_BASE_URL = "not-a-url";
process.env.GH_TOKEN = "";
delete process.env.GITHUB_TOKEN;

try {
  const piExtensionDirectory = join(packageRoot, "packages/pi/extensions");
  const ompExtensionDirectory = join(packageRoot, "packages/omp/extensions");
  await Promise.all([
    mkdir(piExtensionDirectory, { recursive: true }),
    mkdir(ompExtensionDirectory, { recursive: true }),
    cp(join(root, "dist"), join(packageRoot, "dist"), { recursive: true }),
    // The published layout carries no src/, so the shared schemas the Pi extension
    // imports have to come from the packaged packages/shared directory.
    cp(join(root, "packages/shared"), join(packageRoot, "packages/shared"), { recursive: true }),
  ]);
  await Promise.all([
    cp(join(root, "packages/pi/extensions/forges.ts"), join(piExtensionDirectory, "forges.ts")),
    cp(join(root, "packages/omp/extensions/forges.ts"), join(ompExtensionDirectory, "forges.ts")),
  ]);

  await assertDistributionFallback(join(piExtensionDirectory, "forges.ts"), {});
  await assertDistributionFallback(join(ompExtensionDirectory, "forges.ts"), {
    typebox: OmpTypeBox,
    setLabel() {},
  });
  await assertPackedMcpServer(packageRoot);
} finally {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(
  `Packed Pi and OMP extensions loaded dist/tool-operations.mjs; packed dist/mcp.mjs served ${expectedToolNames.length} tools`,
);

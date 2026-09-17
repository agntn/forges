import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as OmpTypeBox from "@oh-my-pi/omptype/typebox";

const root = process.cwd();
const temporaryRoot = await mkdtemp(join(root, ".forges-packed-test-"));
const packageRoot = join(temporaryRoot, "package");
const packageRootUrl = pathToFileURL(`${packageRoot}/`).href;

/**
 * Every module the packed package loads from here on, so each surface can prove
 * what it did not load: provider code before a call needs it, the MCP SDK for
 * `--help`. The hook sees only modules that are not in the cache yet, which is
 * exactly the set the package itself pulls in. The order below follows from
 * that: both extensions register first, the server runs next, and only the tool
 * calls at the end may load the GitHub provider.
 */
const loadedModules = [];
registerHooks({
  load(url, context, nextLoad) {
    loadedModules.push(url);
    return nextLoad(url, context);
  },
});

function loadedPackageFiles() {
  return loadedModules
    .filter((url) => url.startsWith(packageRootUrl))
    .map((url) => url.slice(packageRootUrl.length));
}

function assertNotLoaded(pattern, reason) {
  const offending = loadedPackageFiles().filter((file) => pattern.test(file));
  assert.deepEqual(offending, [], reason);
}

function assertLoaded(pattern, reason) {
  assert(
    loadedPackageFiles().some((file) => pattern.test(file)),
    reason,
  );
}

const providerChunk = /(^|\/)(github|gitlab|gitea)[^/]*\.mjs$/u;
const gitlabOrGiteaChunk = /(^|\/)(gitlab|gitea)[^/]*\.mjs$/u;
const toolOperationsChunk = /(^|\/)tool-operations[^/]*\.mjs$/u;
const environmentKeys = ["FORGES_GITHUB_BASE_URL", "GH_TOKEN", "GITHUB_TOKEN"];
const originalEnvironment = environmentKeys.map((key) => [key, process.env[key]]);
class PackedText {
  constructor(text) {
    this.text = text;
  }

  render() {
    return this.text.split("\n");
  }
}

const expectedToolNames = [
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

function registerPackedExtension(extensionPath, api) {
  const moduleUrl = `${pathToFileURL(extensionPath).href}?packed=${Date.now()}`;
  return import(moduleUrl).then((extension) => {
    const tools = new Map();
    extension.default({
      ...api,
      registerTool(tool) {
        tools.set(tool.name, tool);
      },
    });
    assert.deepEqual([...tools.keys()], expectedToolNames);
    return tools;
  });
}

async function assertDistributionFallback(tools, api) {
  const tool = tools.get("forges_repos_get");
  assert(tool, "forges_repos_get was not registered");
  const args = { platform: "github", owner: "agntn", repo: "forges" };
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  const component = api.typebox
    ? tool.renderCall(args, { isPartial: true, spinnerFrame: 0 }, theme)
    : tool.renderCall(args, theme, { executionStarted: true, isPartial: true });
  assert.match(component.render(120).join("\n"), /Forges Repository agntn\/forges/u);
  await assert.rejects(
    () => tool.execute("packed-test", args, undefined, undefined, {}),
    /Failed to parse URL/,
  );
  assertLoaded(/(^|\/)github[^/]*\.mjs$/u, "a GitHub call loads the GitHub provider");
  assertNotLoaded(gitlabOrGiteaChunk, "a GitHub call must not load the other providers");
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
  assertNotLoaded(toolOperationsChunk, "connecting the server must not load the executors");
  assertNotLoaded(providerChunk, "connecting the server must not load a provider");

  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      expectedToolNames,
    );
    assertNotLoaded(toolOperationsChunk, "listing tools must not load the executors");

    const rejected = await client.callTool({
      name: "forges_repos_get",
      arguments: { platform: "bitbucket", owner: "agntn", repo: "forges" },
    });
    assert.equal(rejected.isError, true);
    assert.match(
      rejected.content.map((part) => part.text).join(""),
      /^Invalid arguments at \/platform/u,
      "the rejection must come from the bundled validator",
    );
    assertLoaded(toolOperationsChunk, "the first call loads the executors");
    assertNotLoaded(providerChunk, "a call rejected by its schema must not load a provider");
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

/**
 * citty resolves every subcommand to print usage, so a static SDK import inside
 * the `mcp` command would load the whole server on `forges --help`.
 */
async function assertHelpStaysLight(root) {
  const hookPath = join(temporaryRoot, "record-loads.mjs");
  await writeFile(
    hookPath,
    [
      'import { registerHooks } from "node:module";',
      "const loaded = [];",
      "registerHooks({ load(url, context, nextLoad) { loaded.push(url); return nextLoad(url, context); } });",
      'process.on("exit", () => { process.stderr.write(`\\n@loaded ${JSON.stringify(loaded)}\\n`); });',
      "",
    ].join("\n"),
  );
  const cliPath = join(root, "dist/cli.mjs");
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(hookPath).href, cliPath, "--help"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(status, 0, `forges --help exited with ${status}: ${stderr}`);
  assert.match(stdout, /forges mcp/u, "usage names the mcp command");
  const recorded = stderr.match(/@loaded (\[.*\])/u);
  assert(recorded, "the load hook reported nothing");
  const loaded = JSON.parse(recorded[1]);
  const sdk = loaded.filter((url) => url.includes("@modelcontextprotocol"));
  assert.deepEqual(sdk, [], "forges --help must not load the MCP SDK");
  const serverEntry = pathToFileURL(join(root, "dist/mcp.mjs")).href;
  assert(!loaded.includes(serverEntry), "forges --help must not load the server entry");
  const typebox = loaded.filter((url) => url.startsWith(packageRootUrl) && url.includes("typebox"));
  assert.deepEqual(typebox, [], "forges --help must not load the tool schemas");
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

  const ompApi = { typebox: OmpTypeBox, pi: { Text: PackedText }, setLabel() {} };
  const piTools = await registerPackedExtension(join(piExtensionDirectory, "forges.ts"), {});
  const ompTools = await registerPackedExtension(join(ompExtensionDirectory, "forges.ts"), ompApi);
  assertNotLoaded(toolOperationsChunk, "registering the extensions must not load the executors");
  await assertPackedMcpServer(packageRoot);
  await assertDistributionFallback(piTools, {});
  await assertDistributionFallback(ompTools, ompApi);
  await assertHelpStaysLight(packageRoot);
} finally {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(
  `Packed Pi and OMP extensions loaded dist/tool-operations.mjs on first call; packed dist/mcp.mjs served ${expectedToolNames.length} tools before loading them; forges --help stayed off the MCP SDK`,
);

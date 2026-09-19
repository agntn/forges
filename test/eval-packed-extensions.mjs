import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { loaded, recordSourcesUnder } from "./record-loads.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as OmpTypeBox from "@oh-my-pi/omptype/typebox";

const root = process.cwd();
const temporaryRoot = await mkdtemp(join(root, ".forges-packed-test-"));
const packageRoot = join(temporaryRoot, "package");
const packageRootUrl = pathToFileURL(`${packageRoot}/`).href;
recordSourcesUnder(packageRootUrl);

/**
 * Load assertions read what the packed package pulled in so far, so the order
 * of the main flow matters: both extensions register first, the server runs
 * next, and only the tool calls at the end may load the GitHub provider.
 */
function loadedPackageModules() {
  return loaded.filter((module) => module.url.startsWith(packageRootUrl));
}

function assertNotLoaded(matches, reason) {
  const offending = loadedPackageModules()
    .filter(matches)
    .map((module) => module.url.slice(packageRootUrl.length));
  assert.deepEqual(offending, [], reason);
}

function assertLoaded(matches, reason) {
  assert(loadedPackageModules().some(matches), reason);
}

/**
 * Matches by the class a module defines: the public name, not the chunk file
 * rolldown picked. Both `class X` and rolldown's `var X = class` count.
 */
function declares(...classes) {
  const names = classes.join("|");
  const pattern = new RegExp(
    String.raw`\bclass\s+(?:${names})\b|\b(?:${names})\s*=\s*class\b`,
    "u",
  );
  return (module) => module.source !== undefined && pattern.test(module.source);
}

const executors = (module) => module.url === `${packageRootUrl}dist/tool-operations.mjs`;
const anyProvider = declares("GitHubProvider", "GitLabProvider", "GiteaProvider");
const gitHubProvider = declares("GitHubProvider");
const otherProviders = declares("GitLabProvider", "GiteaProvider");
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
  "forges_releases_list",
  "forges_releases_get",
  "forges_releases_create",
  "forges_releases_update",
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
  "forges_pull_requests_reviews",
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

async function registerPackedExtension(extensionPath, api) {
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
  return tools;
}

const repositoryArgs = { platform: "github", owner: "agntn", repo: "forges" };

function requireTool(tools, name) {
  const tool = tools.get(name);
  assert(tool, `${name} was not registered`);
  return tool;
}

/** Rendering a call row is pure presentation, so it must not reach for the executors. */
function assertRenderedCall(tool, api) {
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  const component = api.typebox
    ? tool.renderCall(repositoryArgs, { isPartial: true, spinnerFrame: 0 }, theme)
    : tool.renderCall(repositoryArgs, theme, { executionStarted: true, isPartial: true });
  assert.match(component.render(120).join("\n"), /Forges Repository agntn\/forges/u);
}

async function assertDistributionFallback(tool) {
  await assert.rejects(
    () => tool.execute("packed-test", repositoryArgs, undefined, undefined, {}),
    /Failed to parse URL/,
  );
  assertLoaded(gitHubProvider, "a GitHub call loads the GitHub provider");
  assertNotLoaded(otherProviders, "a GitHub call must not load the other providers");
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
  assertNotLoaded(executors, "connecting the server must not load the executors");
  assertNotLoaded(anyProvider, "connecting the server must not load a provider");

  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      expectedToolNames,
    );
    assertNotLoaded(executors, "listing tools must not load the executors");

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
    assertLoaded(executors, "the first call loads the executors");
    assertNotLoaded(anyProvider, "a call rejected by its schema must not load a provider");
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

const execFileAsync = promisify(execFile);

/**
 * citty resolves every subcommand to print usage, so a static SDK import inside
 * the `mcp` command would load the whole server on `forges --help`. The child
 * runs under the same load hook and reports every module on exit.
 */
async function assertHelpStaysLight(root) {
  const hook = new URL("./record-loads.mjs", import.meta.url).href;
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--import", hook, join(root, "dist/cli.mjs"), "--help"],
    { cwd: root, encoding: "utf8", env: { ...process.env, FORGES_REPORT_LOADS: "1" } },
  );
  assert.match(stdout, /forges mcp/u, "usage names the mcp command");
  const recorded = stderr.match(/@loaded (\[.*\])/u);
  assert(recorded, "the load hook reported nothing");
  const urls = JSON.parse(recorded[1]);
  const sdk = urls.filter((url) => url.includes("@modelcontextprotocol"));
  assert.deepEqual(sdk, [], "forges --help must not load the MCP SDK");
  const serverEntry = pathToFileURL(join(root, "dist/mcp.mjs")).href;
  assert(!urls.includes(serverEntry), "forges --help must not load the server entry");
  const typebox = urls.filter((url) => url.startsWith(packageRootUrl) && url.includes("typebox"));
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

  const helpStaysLight = assertHelpStaysLight(packageRoot);
  const ompApi = { typebox: OmpTypeBox, pi: { Text: PackedText }, setLabel() {} };
  const [piTools, ompTools] = await Promise.all([
    registerPackedExtension(join(piExtensionDirectory, "forges.ts"), {}),
    registerPackedExtension(join(ompExtensionDirectory, "forges.ts"), ompApi),
  ]);
  assertNotLoaded(executors, "registering the extensions must not load the executors");
  const piTool = requireTool(piTools, "forges_repos_get");
  const ompTool = requireTool(ompTools, "forges_repos_get");
  assertRenderedCall(piTool, {});
  assertRenderedCall(ompTool, ompApi);
  assertNotLoaded(executors, "rendering a call must not load the executors");
  await assertPackedMcpServer(packageRoot);
  await assertDistributionFallback(piTool);
  await assertDistributionFallback(ompTool);
  await helpStaysLight;
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

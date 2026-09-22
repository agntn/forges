import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { loaded, recordSourcesUnder } from "./record-loads.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
  "forges_pull_requests_create",
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
const localMergeArgs = {
  cwd: join(temporaryRoot, "checkout"),
  head: "HEAD~1",
  mergeCommit: "HEAD",
  target: "HEAD~1",
  paths: ["file.txt"],
};

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
    const verified = await client.callTool({
      name: "forges_local_merge_verify",
      arguments: localMergeArgs,
    });
    assert.notEqual(verified.isError, true);
    assert.equal(JSON.parse(verified.content[0].text).result.pathsMatch, false);
    assert.equal(JSON.parse(verified.content[0].text).result.mergeReachable, false);
    const inspected = await client.callTool({
      name: "forges_local_inspect",
      arguments: {
        cwd: localMergeArgs.cwd,
        paths: ["file.txt"],
        historyLimit: 1,
        filesOffset: 0,
        filesLimit: 1,
      },
    });
    assert.notEqual(inspected.isError, true);
    const inspection = JSON.parse(inspected.content[0].text);
    assert.equal(inspection.platform, "local");
    assert.deepEqual(inspection.result.trackedFiles, ["file.txt"]);
    assert.equal(inspection.result.nextFilesOffset, null);
    const exhausted = await client.callTool({
      name: "forges_local_inspect",
      arguments: { cwd: localMergeArgs.cwd, paths: ["file.txt"], filesOffset: 1, filesLimit: 1 },
    });
    assert.notEqual(exhausted.isError, true);
    assert.deepEqual(JSON.parse(exhausted.content[0].text).result.trackedFiles, []);
    assert.deepEqual(inspection.result.status, []);
    assert.equal(inspection.result.commits.length, 1);
    assert.equal(inspection.result.commits[0].subject, "after");
    assertNotLoaded(anyProvider, "local Git verification must not load a provider");
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

async function assertPackedCommitSearch(piTools, ompTools, root = packageRoot) {
  const identity = { name: "Contributor", email: "test@example.com", date: "2026-09-20T00:00:00Z" };
  const raw = {
    sha: "abc123",
    html_url: "https://github.com/other/project/commit/abc123",
    repository: { full_name: "other/project" },
    commit: { message: "Snapshot iteration", author: identity, committer: identity },
    parents: [],
  };
  const requests = [];
  const http = createServer((request, response) => {
    requests.push(request.url);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ items: [raw], total_count: 1200, incomplete_results: false }));
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  try {
    const address = http.address();
    assert(address && typeof address !== "string");
    process.env.FORGES_GITHUB_BASE_URL = `http://127.0.0.1:${address.port}`;
    const operations = await import(pathToFileURL(join(root, "dist/tool-operations.mjs")).href);
    operations.resetPinnedProviders();
    const { createProvider } = await import(pathToFileURL(join(root, "dist/index.mjs")).href);
    const { createMcpServer } = await import(pathToFileURL(join(root, "dist/mcp.mjs")).href);
    const server = createMcpServer();
    const client = new Client({ name: "commit-search", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      const provider = await createProvider("github", {
        token: "",
        baseURL: process.env.FORGES_GITHUB_BASE_URL,
      });
      const expected = await provider.commits.search("author:contributor", { perPage: 1 });
      assert.equal(expected.items[0].repository, "other/project");
      assert.equal(expected.totalCount, 1200);
      assert.equal(expected.incomplete, true);
      assert.equal(expected.resultLimit, 1000);
      const args = { platform: "github", query: "author:contributor", perPage: 1 };
      for (const tools of [piTools, ompTools]) {
        const answer = await requireTool(tools, "forges_commits_search").execute(
          "search",
          args,
          undefined,
          undefined,
          {},
        );
        assert.deepEqual(answer.details.result, expected);
        assert.deepEqual(
          JSON.parse(answer.content[0].text).result,
          JSON.parse(JSON.stringify(expected)),
        );
      }
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const answer = await client.callTool({ name: "forges_commits_search", arguments: args });
      assert.notEqual(answer.isError, true);
      assert.deepEqual(
        JSON.parse(answer.content[0].text).result,
        JSON.parse(JSON.stringify(expected)),
      );
      assert.equal(requests.length, 4);
      for (const request of requests) {
        const url = new URL(request, process.env.FORGES_GITHUB_BASE_URL);
        assert.equal(url.pathname, "/search/commits");
        assert.equal(url.searchParams.get("q"), "author:contributor");
      }
    } finally {
      await Promise.all([client.close(), server.close()]);
      operations.resetPinnedProviders();
    }
  } finally {
    await new Promise((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function assertPackedPrSearch(piTools, ompTools) {
  const raw = {
    id: 123,
    number: 4,
    title: "Fix search",
    body: "Full body",
    state: "open",
    labels: [],
    user: { login: "contributor" },
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-21T00:00:00Z",
    html_url: "https://github.com/other/project/pull/4",
    pull_request: {},
    draft: false,
  };
  const requests = [];
  const http = createServer((request, response) => {
    requests.push(request.url);
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Link", '<https://api.github.com/search/issues?page=2>; rel="next"');
    response.end(
      JSON.stringify({
        items: [
          { ...raw, repository_url: "https://api.github.com/repos/other/project" },
          { ...raw, repository_url: "https://api.github.com/repos/second/repo" },
        ],
        total_count: 1200,
        incomplete_results: false,
      }),
    );
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  const operations = await import(
    pathToFileURL(join(packageRoot, "dist/tool-operations.mjs")).href
  );
  const client = new Client({ name: "pr-search-cli", version: "1.0.0" });
  try {
    const address = http.address();
    assert(address && typeof address !== "string");
    const baseURL = `http://127.0.0.1:${address.port}`;
    process.env.FORGES_GITHUB_BASE_URL = baseURL;
    operations.resetPinnedProviders();
    const { createProvider } = await import(
      pathToFileURL(join(packageRoot, "dist/index.mjs")).href
    );
    const provider = await createProvider("github", { token: "", baseURL });
    const query = "author:contributor created:>=2026-09-01";
    const options = { perPage: 2, sort: "created", order: "desc" };
    const full = await provider.pullRequests.searchGlobal(query, options);
    assert.deepEqual(
      full.items.map((item) => item.repository),
      ["other/project", "second/repo"],
    );
    assert.equal(full.totalCount, 1200);
    assert.equal(full.incomplete, true);
    assert.equal(full.resultLimit, 1000);
    assert.equal(full.nextPage, 2);
    const expected = { ...full, items: full.items.map(({ body: _body, ...item }) => item) };
    const args = { platform: "github", query, ...options };
    for (const tools of [piTools, ompTools]) {
      const tool = requireTool(tools, "forges_pull_requests_search_global");
      const answer = await tool.execute("search", args, undefined, undefined, {});
      assert.deepEqual(answer.details.result, expected);
      assert.deepEqual(
        JSON.parse(answer.content[0].text).result,
        JSON.parse(JSON.stringify(expected)),
      );
    }
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(packageRoot, "dist/cli.mjs"), "mcp"],
        env: { ...process.env, GH_TOKEN: "", FORGES_GITHUB_BASE_URL: baseURL },
        stderr: "pipe",
      }),
    );
    const discovery = await client.listTools();
    const tool = discovery.tools.find((item) => item.name === "forges_pull_requests_search_global");
    assert(tool);
    assert.deepEqual(tool.inputSchema.required, ["query"]);
    assert.equal(tool.inputSchema.properties.platform.default, "github");
    const answer = await client.callTool({ name: tool.name, arguments: args });
    assert.notEqual(answer.isError, true);
    assert.deepEqual(
      JSON.parse(answer.content[0].text).result,
      JSON.parse(JSON.stringify(expected)),
    );
    const invalid = await client.callTool({
      name: tool.name,
      arguments: { ...args, sort: "bogus" },
    });
    assert.equal(invalid.isError, true);
    assert.equal(requests.length, 4);
    for (const request of requests) {
      const url = new URL(request, baseURL);
      assert.equal(url.pathname, "/search/issues");
      assert.equal(url.searchParams.get("q"), `${query} is:pr`);
      assert.equal(url.searchParams.get("sort"), "created");
      assert.equal(url.searchParams.get("order"), "desc");
    }
  } finally {
    await client.close();
    operations.resetPinnedProviders();
    await new Promise((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

process.env.FORGES_GITHUB_BASE_URL = "not-a-url";
process.env.GH_TOKEN = "";
delete process.env.GITHUB_TOKEN;

try {
  await mkdir(localMergeArgs.cwd);
  const git = (args) =>
    execFileAsync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      { cwd: localMergeArgs.cwd },
    );
  await git(["init", "-q"]);
  await git(["config", "user.name", "Test"]);
  await git(["config", "user.email", "test@example.com"]);
  for (const value of ["before", "after"]) {
    await writeFile(join(localMergeArgs.cwd, "file.txt"), value);
    await git(["add", "file.txt"]);
    await git(["commit", "-qm", value]);
  }
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
  for (const tools of [piTools, ompTools]) {
    const answer = await requireTool(tools, "forges_local_merge_verify").execute(
      "local",
      localMergeArgs,
      undefined,
      undefined,
      {},
    );
    assert.equal(answer.details.platform, "local");
    assert.equal(answer.details.result.pathsMatch, false);
    assert.equal(answer.details.result.mergeReachable, false);
    const inspection = await requireTool(tools, "forges_local_inspect").execute(
      "inspect",
      {
        cwd: localMergeArgs.cwd,
        paths: ["file.txt"],
        historyLimit: 1,
        filesOffset: 0,
        filesLimit: 1,
      },
      undefined,
      undefined,
      {},
    );
    assert.equal(inspection.details.platform, "local");
    assert.deepEqual(inspection.details.result.trackedFiles, ["file.txt"]);
    assert.equal(inspection.details.result.nextFilesOffset, null);
    const exhausted = await requireTool(tools, "forges_local_inspect").execute(
      "inspect-next",
      { cwd: localMergeArgs.cwd, paths: ["file.txt"], filesOffset: 1, filesLimit: 1 },
      undefined,
      undefined,
      {},
    );
    assert.deepEqual(exhausted.details.result.trackedFiles, []);
    assert.deepEqual(inspection.details.result.status, []);
    assert.equal(inspection.details.result.commits.length, 1);
    assert.equal(inspection.details.result.commits[0].subject, "after");
    assert.deepEqual(JSON.parse(inspection.content[0].text), inspection.details);
  }
  assertNotLoaded(anyProvider, "local extension calls must not load a provider");
  await assertDistributionFallback(piTool);
  await assertDistributionFallback(ompTool);
  await helpStaysLight;
  await assertPackedCommitSearch(piTools, ompTools);
  await assertPackedPrSearch(piTools, ompTools);
  await assert.rejects(assertPackedCommitSearch(piTools, ompTools, join(packageRoot, "missing")), {
    code: "ERR_MODULE_NOT_FOUND",
  });
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

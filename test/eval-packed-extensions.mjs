import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import * as OmpTypeBox from "@oh-my-pi/omptype/typebox";

const root = process.cwd();
const temporaryRoot = await mkdtemp(join(root, ".forges-packed-test-"));
const packageRoot = join(temporaryRoot, "package");
const expectedToolNames = [
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
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Packed Pi and OMP extension fallbacks loaded dist/tool-operations.mjs");

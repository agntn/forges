#!/usr/bin/env node

import { existsSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain, type SubCommandsDef } from "citty";
import type McpCommand from "./commands/mcp.ts";
import { version } from "./version.ts";

/**
 * Narrows the module a runtime URL import returned, which TypeScript types as `any`.
 *
 * @param value - The imported module namespace.
 * @returns Whether it exports a default command.
 */
function isCommandModule(value: unknown): value is { default: typeof McpCommand } {
  return typeof value === "object" && value !== null && "default" in value;
}

/**
 * Loads the MCP command. A built bin inside a checkout runs the live source, as the Pi and OMP
 * extensions do, so a local server needs a restart after a change instead of `pnpm build`. The npm
 * package ships no `src` and keeps the bundle. So does a copy under `node_modules`, where Node
 * refuses to strip types, and a Node that strips none, as 22.x before 22.18 does without
 * `--experimental-strip-types`. `FORGES_DIST=1` keeps it everywhere, for tests of the build. The
 * URL is built at runtime, because a literal import would pull the source into the bundle.
 *
 * @returns The citty command that starts the stdio server.
 */
async function loadMcpCommand(): Promise<typeof McpCommand> {
  // The same file from `src/cli.ts` and `dist/cli.mjs`; the npm package ships no `src`.
  const sourceMcpCommand = new URL("../src/commands/mcp.ts", import.meta.url);
  const sourcePath = fileURLToPath(sourceMcpCommand);
  const fromSource =
    !import.meta.url.endsWith(".ts") &&
    Boolean(process.features.typescript) &&
    process.env.FORGES_DIST !== "1" &&
    !sourcePath.includes(`${sep}node_modules${sep}`) &&
    existsSync(sourcePath);
  if (!fromSource) return (await import("./commands/mcp.ts")).default;
  const module: unknown = await import(sourceMcpCommand.href);
  if (!isCommandModule(module)) {
    throw new TypeError(`${sourcePath} has no default command`);
  }
  return module.default;
}

// citty looks a subcommand up on the object itself, so a plain literal answers
// `toString`, `constructor` and friends from Object.prototype: the name resolves,
// nothing runs, and the process exits 0 as if the server had started.
const subCommands: SubCommandsDef = Object.assign(Object.create(null) as SubCommandsDef, {
  mcp: loadMcpCommand,
});

const main = defineCommand({
  meta: {
    name: "forges",
    version,
    description: "One API for GitHub, GitLab, Gitea, and GitBucket",
  },
  subCommands,
});

await runMain(main);

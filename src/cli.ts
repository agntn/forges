#!/usr/bin/env node

import { existsSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import type * as McpCommand from "./commands/mcp.ts";
import { version } from "./version.ts";

/**
 * Narrows the module a runtime URL import returned, which TypeScript types as `any`.
 *
 * @param value - The imported module namespace.
 * @returns Whether it exports `serveMcp`.
 */
function isMcpModule(value: unknown): value is typeof McpCommand {
  return typeof value === "object" && value !== null && "serveMcp" in value;
}

/**
 * Loads the MCP command. A built bin inside a checkout runs the live source, as the Pi and OMP
 * extensions do, so a local server needs a restart after a change instead of `pnpm build`. The npm
 * package ships no `src` and keeps the bundle. So does a copy under `node_modules`, where Node
 * refuses to strip types, and a Node started with `--no-experimental-strip-types`. `FORGES_DIST=1`
 * keeps it everywhere, for tests of the build. The URL is built at runtime, because a literal import
 * would pull the source into the bundle.
 *
 * @returns The module that starts the stdio server.
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
  if (!fromSource) return import("./commands/mcp.ts");
  const module: unknown = await import(sourceMcpCommand.href);
  if (!isMcpModule(module)) {
    throw new TypeError(`${sourcePath} has no serveMcp`);
  }
  return module;
}

/** A bare `forges mcp` serves our server, with the title and website the generated one lacks. */
const argv = process.argv.slice(2);

if (argv.length === 1 && argv[0] === "mcp") {
  await (await loadMcpCommand()).serveMcp();
} else {
  const [{ runCli }, { forgesTools }, { ForgesError }] = await Promise.all([
    import("@agntn/tools/cli"),
    import("./tools.ts"),
    import("./errors.ts"),
  ]);
  await runCli(
    {
      name: "forges",
      version,
      description: "One API for GitHub, GitLab, Gitea, and GitBucket",
      tools: forgesTools(),
      mcp: true,
      expected: (error) => error instanceof ForgesError,
    },
    argv,
  );
}

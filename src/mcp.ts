import type { Server } from "@modelcontextprotocol/server";
import { createMcpServer as createToolServer } from "@agntn/tools/mcp";

import { forgesTools } from "./tools.ts";
import { version } from "./version.ts";

/**
 * Creates an unconnected MCP server exposing repository, CI-run, issue,
 * pull-request, user, and review-thread tools.
 *
 * The same definitions Pi, OMP and the CLI register; executors load with the first `tools/call`.
 *
 * Tokens and endpoints stay out of the tool surface: credentials come from the
 * local detection chain and self-hosted endpoints from the `FORGES_*_BASE_URL`
 * variables of the server process.
 */
export function createMcpServer(): Server {
  return createToolServer(
    { name: "forges", title: "Forges", version, websiteUrl: "https://github.com/agntn/forges" },
    forgesTools(),
  );
}

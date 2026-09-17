import { defineCommand } from "citty";

/**
 * The `forges mcp` command.
 *
 * citty resolves every subcommand to print `--help`, so the SDK and the server
 * module are imported inside `run()` and load only when the server starts.
 */
export default defineCommand({
  meta: {
    name: "mcp",
    description: "Run the forges MCP server over stdio",
  },
  async run() {
    const [{ StdioServerTransport }, { createMcpServer }] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/stdio.js"),
      import("../mcp.ts"),
    ]);
    await createMcpServer().connect(new StdioServerTransport());
  },
});

/** `forges mcp` over stdio; the SDK loads only here, so `--help` never parses it. */
export async function serveMcp(): Promise<void> {
  const [{ StdioServerTransport }, { createMcpServer }] = await Promise.all([
    import("@modelcontextprotocol/server/stdio"),
    import("../mcp.ts"),
  ]);
  await createMcpServer().connect(new StdioServerTransport());
}

/** `forges mcp` over stdio for 2025 and 2026 clients; `--help` never loads the SDK. */
export async function serveMcp(): Promise<void> {
  const [{ serveStdio }, { createMcpServer }] = await Promise.all([
    import("@modelcontextprotocol/server/stdio"),
    import("../mcp.ts"),
  ]);
  serveStdio(() => createMcpServer());
}

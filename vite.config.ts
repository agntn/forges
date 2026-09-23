import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["dist", "CHANGELOG.md"],
  },
  lint: {
    plugins: ["unicorn", "typescript", "oxc"],
    ignorePatterns: ["dist"],
  },
  test: {
    environment: "node",
    globals: true,
  },
  /**
   * One bundle, all inputs, so the entries share chunks instead of each embedding its own copy.
   * Chunks keep stable names under `_chunks`, as obuild wrote them.
   */
  pack: {
    entry: {
      index: "src/index.ts",
      local: "src/local.ts",
      cli: "src/cli.ts",
      mcp: "src/mcp.ts",
      github: "src/github.ts",
      gitlab: "src/gitlab.ts",
      gitea: "src/gitea.ts",
      provider: "src/provider.ts",
      types: "src/types.ts",
      "tool-operations": "src/tool-operations.ts",
    },
    dts: true,
    format: "esm",
    platform: "node",
    hash: false,
    outputOptions: {
      chunkFileNames: "_chunks/[name].mjs",
      /* JSDoc ships once, in the declarations; the runtime files keep only legal and annotation comments. */
      comments: { jsdoc: false },
    },
    /**
     * typebox stays inline: resolving and parsing it from node_modules costs the MCP server more at
     * every spawn than the bundled copy does.
     */
    deps: {
      onlyBundle: [/^typebox(?:\/|$)/u],
      alwaysBundle: [/^typebox(?:\/|$)/u],
    },
    /* The inlined typebox carries no license header of its own, so its MIT notice ships beside it. */
    copy: [{ from: "node_modules/typebox/license", rename: "typebox.LICENSE" }],
    /**
     * Rolldown marks every source module with `//#region <path>` and has no option to turn that off.
     * Inlined typebox brings one per module, each spelling out its pnpm store path.
     */
    plugins: [
      {
        name: "strip-regions",
        renderChunk: (code: string) => code.replaceAll(/^\/\/#(?:end)?region\b.*(?:\n|$)/gmu, ""),
      },
    ],
  },
});

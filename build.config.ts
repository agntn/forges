import { defineBuildConfig } from "obuild/config";

/** typebox stays inline, since every MCP spawn parses it slower from node_modules. */
const isTypebox = (id: string): boolean => /^typebox(?:\/|$)/u.test(id);

export default defineBuildConfig({
  entries: [
    {
      /** One bundle, so the entries share chunks instead of each embedding its own copy. */
      type: "bundle",
      input: [
        "./src/index.ts",
        "./src/local.ts",
        "./src/cli.ts",
        "./src/mcp.ts",
        "./src/github.ts",
        "./src/gitlab.ts",
        "./src/gitea.ts",
        "./src/provider.ts",
        "./src/types.ts",
        "./src/tool-operations.ts",
      ],
    },
  ],
  hooks: {
    /** obuild marks the typebox peer external by name and by subpath, and both have to go. */
    rolldownConfig(config) {
      if (!Array.isArray(config.external)) return;
      config.external = config.external.filter((entry) =>
        typeof entry === "string"
          ? !isTypebox(entry)
          : !(entry instanceof RegExp && entry.test("typebox/value")),
      );
    },
  },
});

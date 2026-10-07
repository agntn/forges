import { defineBuildConfig } from "obuild/config";

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
        "./src/tools.ts",
      ],
    },
  ],
});

import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  declaration: true,
  rollup: {
    emitCJS: false,
  },
  entries: [
    {
      type: "bundle",
      input: [
        "./src/index.ts",
        "./src/github.ts",
        "./src/gitlab.ts",
        "./src/gitea.ts",
        "./src/provider.ts",
        "./src/types.ts",
      ],
    },
  ],
  externals: ["node:child_process", "node:fs", "node:os", "node:path"],
});

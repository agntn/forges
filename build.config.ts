import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  declaration: true,
  rollup: {
    emitCJS: false,
  },
  entries: [
    "src/index",
    "src/github",
    "src/gitlab",
    "src/gitea",
    "src/types",
  ],
  externals: [
    "node:child_process",
    "node:fs",
    "node:os",
    "node:path",
  ],
});

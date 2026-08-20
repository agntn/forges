#!/usr/bin/env node

import { defineCommand, runMain, type SubCommandsDef } from "citty";
import { version } from "./version.ts";

// citty looks a subcommand up on the object itself, so a plain literal answers
// `toString`, `constructor` and friends from Object.prototype: the name resolves,
// nothing runs, and the process exits 0 as if the server had started.
const subCommands: SubCommandsDef = Object.assign(Object.create(null) as SubCommandsDef, {
  mcp: () => import("./commands/mcp.ts").then((m) => m.default),
});

const main = defineCommand({
  meta: {
    name: "forges",
    version,
    description: "One API for GitHub, GitLab, Gitea, and GitBucket",
  },
  subCommands,
});

await runMain(main);

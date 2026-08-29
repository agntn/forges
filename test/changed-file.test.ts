import { describe, expect, it } from "vitest";

import { countDiffLines, normalizeChangedFileStatus } from "../src/changed-file.ts";

describe("normalizeChangedFileStatus", () => {
  it.each([
    ["added", "added"],
    ["deleted", "removed"],
    ["changed", "modified"],
    ["renamed", "renamed"],
    ["copied", "copied"],
    ["unrecognized", "unknown"],
  ] as const)("maps %s to %s", (raw, normalized) => {
    expect(normalizeChangedFileStatus(raw)).toBe(normalized);
  });
});

describe("countDiffLines", () => {
  it("counts hunk content without treating file headers as changes", () => {
    const diff = [
      "--- a/src/provider.ts",
      "+++ b/src/provider.ts",
      "@@ -1,2 +1,3 @@",
      " unchanged",
      "-old",
      "+new",
      "+added",
    ].join("\n");

    expect(countDiffLines(diff)).toEqual({ additions: 2, deletions: 1 });
  });
});

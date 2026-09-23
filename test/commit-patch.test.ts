import { describe, expect, it } from "vite-plus/test";

import { buildCommitPatch } from "../src/commit-patch.ts";
import type { CommitPatchFile } from "../src/types.ts";

const files: CommitPatchFile[] = [
  {
    path: "src/renamed.ts",
    previousPath: "src/old.ts",
    status: "renamed",
    state: "included",
    patch: "@@ -1 +1 @@\n-old\n+new\n",
  },
  {
    path: "public/logo.png",
    previousPath: null,
    status: "modified",
    state: "binary",
    patch: "",
  },
  {
    path: "generated.txt",
    previousPath: null,
    status: "modified",
    state: "unavailable",
    patch: "",
  },
];

describe("buildCommitPatch", () => {
  it("continues a long stream without gaps across slice boundaries", () => {
    const first = buildCommitPatch("resolved", files, true, { maxChars: 37 });
    expect(first).toMatchObject({ sha: "resolved", offset: 0, nextOffset: 37, truncated: true });

    const second = buildCommitPatch("resolved", files, true, {
      offset: first.nextOffset ?? 0,
      maxChars: 200_000,
    });
    const whole = buildCommitPatch("resolved", files, true, { maxChars: 200_000 });

    expect(first.content + second.content).toBe(whole.content);
    expect(second).toMatchObject({ nextOffset: null, truncated: false });
  });

  it("distinguishes renamed, binary, unavailable, and truncated patch content", () => {
    const full = buildCommitPatch("resolved", files, null, { maxChars: 200_000 });
    const bounded = buildCommitPatch("resolved", files, null, { maxChars: 80 });

    expect(full.content).toContain("--- renamed src/renamed.ts from src/old.ts");
    expect(full.content).toContain("[binary patch omitted]");
    expect(full.content).toContain("[patch unavailable from provider]");
    expect(full.states).toEqual({ included: 1, binary: 1, unavailable: 1 });
    expect(bounded.truncated).toBe(true);
  });

  it("filters one file before applying the output budget", () => {
    const result = buildCommitPatch("resolved", files, true, {
      path: "public/logo.png",
      maxChars: 200_000,
    });

    expect(result.content).toContain("[binary patch omitted]");
    expect(result.content).not.toContain("src/renamed.ts");
    expect(result.path).toBe("public/logo.png");
  });

  it("rejects invalid continuation bounds", () => {
    expect(() => buildCommitPatch("resolved", files, true, { offset: -1 })).toThrow(
      "offset must be a non-negative integer",
    );
    expect(() => buildCommitPatch("resolved", files, true, { maxChars: 200_001 })).toThrow(
      "maxChars must be an integer",
    );
    expect(() =>
      buildCommitPatch("resolved", files, true, {
        offset: Number.MAX_SAFE_INTEGER,
        maxChars: 1,
      }),
    ).toThrow("safe integer limit");
    expect(() => buildCommitPatch("resolved", files, true, { offset: 10_000 })).toThrow(
      "past the end",
    );
  });
});

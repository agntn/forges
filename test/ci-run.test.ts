import { describe, expect, it } from "vitest";

import { normalizeCiRunState } from "../src/ci-run.ts";

describe("normalizeCiRunState", () => {
  it.each([
    ["error", "failure"],
    ["warning", "neutral"],
  ] as const)("maps terminal Gitea status %s to %s", (raw, conclusion) => {
    expect(normalizeCiRunState(raw)).toEqual({ status: "completed", conclusion });
  });
});

import { describe, expect, it } from "vite-plus/test";

import { cursorScope, decodeCursor, encodeCursor } from "../src/cursor.ts";

const origin = "https://git.example.com";

describe("page cursors", () => {
  it("reads back every cursor it writes, a long next-page URL included", () => {
    const url = `${origin}/api/v4/projects/${"group%2F".repeat(200)}repo/repository/commits?ref_name=${"x".repeat(400)}&page=2`;
    const scope = cursorScope(["group", "repo", { ref: "main" }]);

    const cursor = encodeCursor("commits.list", { url }, scope);

    expect(cursor.length).toBeGreaterThan(2048);
    expect(decodeCursor(cursor, "commits.list", origin, "gitlab", scope)).toEqual({ url });
  });

  it("refuses a cursor from another repository or other filters of the same listing", () => {
    const cursor = encodeCursor(
      "issues.list",
      { url: `${origin}/api/v1/repos/a/one/issues?page=2` },
      cursorScope(["a", "one", { state: "open" }]),
    );

    for (const scope of [
      cursorScope(["b", "two", { state: "open" }]),
      cursorScope(["a", "one", { state: "closed" }]),
    ]) {
      expect(() => decodeCursor(cursor, "issues.list", origin, "gitea", scope)).toThrow(
        expect.objectContaining({ status: 400 }),
      );
    }
  });

  it("gives the same scope whatever order the filters came in", () => {
    expect(cursorScope(["o", "r", { state: "all", labels: ["bug"] }])).toBe(
      cursorScope(["o", "r", { labels: ["bug"], state: "all" }]),
    );
  });
});

import { describe, expect, it } from "vite-plus/test";

import { assertItemBodyOptions, hashBody, itemBody, sliceItemBody } from "../src/body-window.ts";
import { hashReleaseNotes } from "../src/release-notes.ts";

const pullRequest = {
  number: 141,
  title: "chore(deps): update minor dependencies (minor)",
  body: "| `typebox` | dependencies | minor | `1.3.37` → `1.4.0` |\n".repeat(1000),
  sourceBranch: "renovate/minor-dependencies",
};
const about = itemBody("Pull request body", "github");

describe("sliceItemBody", () => {
  it("cuts the default window and keeps the rest of the item", () => {
    const first = sliceItemBody(pullRequest, { about });

    expect(pullRequest.body.length).toBe(58_000);
    expect(first).toEqual({
      ...pullRequest,
      body: pullRequest.body.slice(0, 20_000),
      offset: 0,
      nextOffset: 20_000,
      truncated: true,
      length: 58_000,
      bodyHash: hashBody(pullRequest.body),
    });
  });

  it("reads the whole body back without gaps by following nextOffset", () => {
    const parts: string[] = [];
    let offset: number | null = 0;
    let bodyHash: string | undefined;
    while (offset !== null) {
      const slice = sliceItemBody(pullRequest, { offset, bodyHash, about });
      parts.push(slice.body);
      offset = slice.nextOffset;
      bodyHash = slice.bodyHash;
    }

    expect(parts).toHaveLength(3);
    expect(parts.join("")).toBe(pullRequest.body);
  });

  it("refuses to continue a body edited since the first read", () => {
    const first = sliceItemBody(pullRequest, { about });
    const edited = { ...pullRequest, body: `Rebased.\n${pullRequest.body}` };

    expect(() =>
      sliceItemBody(edited, { offset: 20_000, bodyHash: first.bodyHash, about }),
    ).toThrow(
      expect.objectContaining({
        status: 409,
        message:
          "Pull request body changed since the read that returned this bodyHash. Read again from offset 0",
      }),
    );
  });

  it("hands a short body back untouched", () => {
    const issue = { number: 336, body: "" };

    expect(sliceItemBody(issue, { about: itemBody("Issue body") })).toEqual({
      ...issue,
      offset: 0,
      nextOffset: null,
      truncated: false,
      length: 0,
      bodyHash: hashBody(""),
    });
  });

  it("refuses an offset past the end of the body", () => {
    const issue = { number: 336, body: "short" };

    expect(() =>
      sliceItemBody(issue, {
        offset: 6,
        bodyHash: hashBody("short"),
        about: itemBody("Issue body"),
      }),
    ).toThrow("Issue body offset is past the end of the body");
  });

  it("fingerprints a body the same way as release notes", () => {
    expect(hashBody("## Changelog")).toBe(hashReleaseNotes("## Changelog"));
  });
});

describe("assertItemBodyOptions", () => {
  it.each([
    [{ offset: -1 }, "Issue body offset must be a non-negative integer"],
    [{ maxChars: 200_001 }, "Issue body maxChars must be an integer from 1 to 200000"],
    [{ offset: 20_000 }, "Issue body offset needs the bodyHash of the read it continues"],
    [{ bodyHash: "0123456789ABCDEF" }, "Issue body bodyHash must be the 16 hex digits"],
  ])("refuses %o", (options, message) => {
    expect(() => assertItemBodyOptions(options, itemBody("Issue body", "gitlab"))).toThrow(
      expect.objectContaining({
        status: 400,
        platform: "gitlab",
        message: expect.stringContaining(message),
      }),
    );
  });
});

import { describe, expect, it } from "vite-plus/test";

import { assertReleaseNotesOptions, sliceReleaseNotes } from "../src/release-notes.ts";
import type { Release } from "../src/types.ts";

const release: Release = {
  id: "263093511",
  tag: "v4.6.0",
  name: "v4.6.0",
  body: "## 🚀 Enhancements\n".repeat(4000),
  draft: false,
  prerelease: false,
  author: { login: "danielroe" },
  createdAt: "2026-10-15T09:12:44Z",
  publishedAt: "2026-10-15T09:31:02Z",
  url: "https://github.com/nuxt/nuxt/releases/tag/v4.6.0",
};

describe("sliceReleaseNotes", () => {
  it("cuts the default window and keeps the rest of the release", () => {
    const first = sliceReleaseNotes(release);

    expect(release.body.length).toBe(76_000);
    expect(first).toEqual({
      ...release,
      body: release.body.slice(0, 20_000),
      offset: 0,
      nextOffset: 20_000,
      truncated: true,
      length: 76_000,
    });
  });

  it("reads the whole notes back without gaps by following nextOffset", () => {
    const parts: string[] = [];
    let offset: number | null = 0;
    let reads = 0;
    while (offset !== null) {
      const slice = sliceReleaseNotes(release, { offset, maxChars: 30_000 });
      parts.push(slice.body);
      offset = slice.nextOffset;
      reads += 1;
    }

    expect(reads).toBe(3);
    expect(parts.join("")).toBe(release.body);
  });

  it("returns short notes whole with nothing left to read", () => {
    const short = { ...release, body: "Bug fixes" };

    expect(sliceReleaseNotes(short)).toMatchObject({
      body: "Bug fixes",
      offset: 0,
      nextOffset: null,
      truncated: false,
      length: 9,
    });
    expect(sliceReleaseNotes({ ...release, body: "" })).toMatchObject({
      body: "",
      nextOffset: null,
      length: 0,
    });
    expect(sliceReleaseNotes(short, { offset: 9 })).toMatchObject({ body: "", nextOffset: null });
  });

  it("refuses an offset past the end of the notes", () => {
    expect(() => sliceReleaseNotes({ ...release, body: "Bug fixes" }, { offset: 10 })).toThrow(
      "Release notes offset is past the end of the notes",
    );
  });
});

describe("assertReleaseNotesOptions", () => {
  it.each([
    [{ offset: -1 }, "Release notes offset must be a non-negative integer"],
    [{ offset: 1.5 }, "Release notes offset must be a non-negative integer"],
    [{ maxChars: 0 }, "Release notes maxChars must be an integer from 1 to 200000"],
    [{ maxChars: 200_001 }, "Release notes maxChars must be an integer from 1 to 200000"],
    [
      { offset: Number.MAX_SAFE_INTEGER, maxChars: 1 },
      "Release notes range exceeds the safe integer limit",
    ],
  ])("refuses %o", (options, message) => {
    expect(() => assertReleaseNotesOptions(options, "github")).toThrow(message);
  });
});

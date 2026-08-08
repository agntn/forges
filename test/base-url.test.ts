import { describe, expect, it } from "vitest";
import { encodePathSegment } from "../src/providers/base-url.ts";

describe("encodePathSegment", () => {
  it.each([
    ["hello world", "hello%20world"],
    ["mañana", "ma%C3%B1ana"],
    [42, "42"],
  ])("encodes %j as one path segment", (value, expected) => {
    expect(encodePathSegment(value)).toBe(expected);
  });

  it.each(["", ".", "..", "owner/repo", "owner\\repo", "already%20encoded", "\0", "\n", "\x7f"])(
    "rejects unsafe string %j",
    (value) => {
      expect(() => encodePathSegment(value)).toThrow("Invalid API path segment");
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53])(
    "rejects unsafe number %j",
    (value) => {
      expect(() => encodePathSegment(value)).toThrow("Invalid API path segment");
    },
  );
});

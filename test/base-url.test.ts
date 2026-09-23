import { describe, expect, it } from "vitest";
import {
  encodeApiResponsePathSegment,
  encodeLabelPathSegment,
  encodePathSegment,
  encodeRefPathSegment,
} from "../src/providers/base-url.ts";

describe("encodeLabelPathSegment", () => {
  it.each([
    ["kind/bug", "kind%2Fbug"],
    ["100%", "100%25"],
    ["good first issue", "good%20first%20issue"],
    ["a\\b", "a%5Cb"],
  ])("encodes the label %j as one path segment", (name, expected) => {
    expect(encodeLabelPathSegment(name)).toBe(expected);
  });

  it.each(["", ".", "..", "\0", "\n"])("rejects %j", (name) => {
    expect(() => encodeLabelPathSegment(name)).toThrow("Invalid label name");
  });
});

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

describe("encodeRefPathSegment", () => {
  it.each([
    ["v1.2.3", "v1.2.3"],
    ["v1.0-rc.1", "v1.0-rc.1"],
    ["release/1.2", "release%2F1.2"],
    ["100%", "100%25"],
    ["@scope/pkg@1.0.0", "%40scope%2Fpkg%401.0.0"],
    ["a.lockfile", "a.lockfile"],
    ["@", "%40"],
  ])("encodes the ref %j as one segment", (value, expected) => {
    expect(encodeRefPathSegment(value)).toBe(expected);
  });

  it.each([
    "",
    " v1.0",
    "v1 0",
    ".",
    "..",
    "x..y",
    "v1.0.",
    ".hidden",
    "a/.b",
    "v1.lock",
    "v1.lock/x",
    "a@{b",
    "a:b",
    "a~b",
    "a^b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
    "/v1",
    "v1/",
    "a//b",
    "\0",
    "\n",
    "\x7f",
  ])("rejects %j, which git check-ref-format refuses too", (value) => {
    expect(() => encodeRefPathSegment(value)).toThrow("Invalid git ref path segment");
  });
});

describe("encodeApiResponsePathSegment", () => {
  it("encodes literal percent signs returned in forge filenames", () => {
    expect(encodeApiResponsePathSegment("100%.md")).toBe("100%25.md");
    expect(encodeApiResponsePathSegment("already%20literal.md")).toBe("already%2520literal.md");
  });

  it.each(["", ".", "..", "owner/repo", "owner\\repo", "\0", "\n", "\x7f"])(
    "rejects unsafe response segment %j",
    (value) => {
      expect(() => encodeApiResponsePathSegment(value)).toThrow(
        "Invalid API response path segment",
      );
    },
  );
});

import { describe, expect, it } from "vite-plus/test";
import { redactEndpoint } from "../src/redact-endpoint.ts";

const forge = new Set(["ghe.internal.example"]);

describe("redactEndpoint", () => {
  it.each([
    ["See (https://build.example.net) for details", "See (https://build.example.net) for details"],
    [
      "log at https://build.example.net/7, then retry",
      "log at https://build.example.net/7, then retry",
    ],
    ["See (https://ghe.internal.example) for details", "See (<endpoint>) for details"],
    ['at "https://ghe.internal.example/x".', 'at "<endpoint>".'],
    ["at https://ghe.internal.example./x", "at <endpoint>"],
    ["at https://ghe.internal.example)/x", "at <endpoint>"],
    ["at https://build.example.net/#access_token=abc123", "at <endpoint>"],
    ["at https://build.example.net/#logs", "at https://build.example.net/#logs"],
  ])("reads %j as %j", (message, expected) => {
    expect(redactEndpoint(message, forge)).toBe(expected);
  });

  it("hides every URL without a host list", () => {
    expect(redactEndpoint("at https://build.example.net/7")).toBe("at <endpoint>");
  });
});

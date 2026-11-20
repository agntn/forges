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
    [
      "at https://github.com/o/r/issues?assignee=a&author=b",
      "at https://github.com/o/r/issues?assignee=a&author=b",
    ],
    ["at https://logs.example.net/7?X-Amz-Signature=abc123", "at <endpoint>"],
    ["at https://logs.example.net/7?apiKey=abc123", "at <endpoint>"],
    ["at https://logs.example.net/7?jwt=abc123", "at <endpoint>"],
    ["at https://logs.example.net/7?accessToken=abc123", "at <endpoint>"],
    ["at https://logs.example.net/7?clientsecret=abc123", "at <endpoint>"],
    ["at https://logs.example.net/7?apitoken=abc123", "at <endpoint>"],
    ["at https://logs.example.net/v/eyJhbGciOi.eyJzdWIiOi.c2ln/log", "at <endpoint>"],
    [
      '{"help":"https://docs.example/help","endpoint":"https://ghe.internal.example/api/v3"}',
      '{"help":"https://docs.example/help","endpoint":"<endpoint>"}',
    ],
    ["at https://docs.example/r?to=https://ghe.internal.example/x", "at <endpoint>"],
  ])("reads %j as %j", (message, expected) => {
    expect(redactEndpoint(message, forge)).toBe(expected);
  });

  it("hides every URL without a host list", () => {
    expect(redactEndpoint("at https://build.example.net/7")).toBe("at <endpoint>");
  });
});

import { describe, expect, it } from "vitest";
import {
  getToolEffect,
  toolAnnotations,
  toolApproval,
  toolEffects,
} from "../packages/shared/tool-effects.ts";
import { renderToolCall, renderToolResult } from "../packages/shared/tui.ts";

const writes = [
  "forges_releases_create",
  "forges_releases_update",
  "forges_issues_create",
  "forges_pull_requests_create",
  "forges_auth_reload",
  "forges_threads_reply",
  "forges_threads_resolve",
  "forges_threads_unresolve",
];

describe("tool effects", () => {
  it("preserves the distinct operation effects", () => {
    expect(getToolEffect("forges_repos_get")).toBe("hostedRead");
    expect(getToolEffect("forges_local_inspect")).toBe("localRead");
    expect(getToolEffect("forges_local_merge_verify")).toBe("localRead");
    expect(getToolEffect("forges_releases_create")).toBe("remoteCreate");
    expect(getToolEffect("forges_releases_update")).toBe("remoteUpdate");
    expect(getToolEffect("forges_threads_resolve")).toBe("remoteState");
    expect(getToolEffect("forges_auth_reload")).toBe("credentialReload");
    expect(toolAnnotations("forges_auth_reload")).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it.each(["forges_future_tool", "toString", "__proto__"])(
    "rejects unclassified tool %s instead of assuming a read",
    (name) => {
      expect(() => getToolEffect(name)).toThrow("Missing tool effect");
      expect(() => toolApproval(name)).toThrow("Missing tool effect");
      expect(() => renderToolCall(name, name, {}, {}, {})).toThrow("Missing tool effect");
    },
  );

  it("renders every registered effect consistently without executing tools", () => {
    for (const name of Object.keys(toolEffects)) {
      const write = writes.includes(name);
      expect(toolApproval(name)).toBe(write ? "write" : "read");
      expect(renderToolCall(name, name, {}, {}, {}).includes("(write)")).toBe(write);
      expect(renderToolResult(name, { content: [] }, false, {}, {})).toContain(
        write ? "(write)" : "(read)",
      );
    }
  });
});

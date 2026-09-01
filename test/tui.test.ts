import { describe, expect, it } from "vitest";

import {
  forgeToolTitle,
  renderToolCall,
  renderToolResult,
  sanitizeTerminalText,
} from "../packages/shared/tui.ts";

const plain = {};
const escape = String.fromCodePoint(27);
const bell = String.fromCodePoint(7);

describe("Forges tool TUI", () => {
  it("shares category marks with human-facing tool titles", () => {
    expect(forgeToolTitle("forges_repos_list", "List Repositories")).toBe("◆ List Repositories");
    expect(forgeToolTitle("forges_pull_requests_get", "Get Pull Request")).toBe(
      "↗ Get Pull Request",
    );
  });

  it("renders the repository target, call state, and write boundary", () => {
    const read = renderToolCall(
      "forges_issues_get",
      "Forges Issue",
      { platform: "github", owner: "agntn", repo: "forges", number: 42 },
      { executionStarted: true, isPartial: true },
      plain,
    );
    const write = renderToolCall(
      "forges_pull_requests_create",
      "Create Forges Pull Request",
      {
        platform: "github",
        owner: "agntn",
        repo: "forges",
        title: "Improve tool UI",
        sourceBranch: "feat/tui",
        targetBranch: "main",
      },
      { isPartial: true, spinnerFrame: 1 },
      plain,
    );

    expect(read).toBe("◌ ◈ Forges Issue agntn/forges#42 platform github");
    expect(write).toBe(
      "⠙ ↗ Create Forges Pull Request Improve tool UI (write) agntn/forges · feat/tui → main · platform github",
    );
  });

  it("summarizes a page instead of dumping JSON while collapsed", () => {
    const result = {
      content: [{ type: "text", text: JSON.stringify({ items: [{ id: 1 }, { id: 2 }] }) }],
      details: {
        platform: "github",
        result: { items: [{ id: 1 }, { id: 2 }], hasNextPage: true, nextPage: 2 },
      },
    };

    expect(renderToolResult("forges_issues_list", result, false, {}, plain)).toBe(
      "✓ (read) 2 items · next page 2",
    );
  });

  it("keeps the complete sanitized JSON available on expansion", () => {
    const result = {
      content: [
        {
          type: "text",
          text: `{"title":"${escape}]0;evil${bell}kept"}\n{"state":"open"}`,
        },
      ],
      details: { platform: "github", result: { number: 42, state: "open" } },
    };
    const expanded = renderToolResult(
      "forges_issues_get",
      result,
      false,
      { expanded: true },
      plain,
    );

    expect(expanded).toBe('✓ (read) #42 · open\n  {"title":"kept"}\n  {"state":"open"}');
    expect(expanded).not.toContain(escape);
  });

  it("reads failures separately from each harness result shape", () => {
    const result = {
      content: [{ type: "text", text: "Repository not found\nCheck the owner and name" }],
    };

    expect(renderToolResult("forges_repos_get", result, true, {}, plain)).toBe(
      "✗ Repository not found (failed)\n  Check the owner and name",
    );
    expect(
      renderToolResult("forges_repos_get", { ...result, isError: true }, false, {}, plain),
    ).toBe("✗ Repository not found (failed)\n  Check the owner and name");
  });

  it("keeps a long failure line that the header had to shorten", () => {
    const reason = `Failure: ${"x".repeat(120)}`;
    const rendered = renderToolResult(
      "forges_repos_get",
      { content: [{ type: "text", text: reason }] },
      true,
      {},
      plain,
    );

    expect(rendered.split("\n")).toEqual([`✗ ${reason.slice(0, 71)}… (failed)`, `  ${reason}`]);
  });

  it("sanitizes malformed and terminal-active fields", () => {
    const malformed = String.fromCodePoint(0xd800);
    expect(sanitizeTerminalText(`${escape}[31mred${escape}]0;title${bell}${malformed}text`)).toBe(
      "red text",
    );
    for (const codePoint of [0x9b, 0x2028, 0x202e]) {
      expect(sanitizeTerminalText(`a${String.fromCodePoint(codePoint)}b`)).toBe("a b");
    }
    expect(
      renderToolCall(
        "forges_repos_get",
        "Forges Repository",
        { owner: `${escape}]0;evil${bell}agntn`, repo: "forges" },
        {},
        plain,
      ),
    ).toBe("· ◆ Forges Repository agntn/forges");
  });
});

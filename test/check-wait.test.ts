import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { MAX_CHECK_WAIT_SECONDS, waitForChecks, type ReadCheckPage } from "../src/check-wait.ts";
import type { PageResult, PullRequestCheck } from "../src/types.ts";

function check(name: string, running: boolean): PullRequestCheck {
  return {
    id: name,
    name,
    status: running ? "in_progress" : "completed",
    conclusion: running ? null : "success",
    url: `https://example.test/${name}`,
  };
}

function page(items: PullRequestCheck[], nextPage?: number): PageResult<PullRequestCheck> {
  return {
    items,
    totalCount: items.length,
    hasNextPage: nextPage !== undefined,
    nextPage,
  };
}

/** Feeds one scripted response per poll; the last one repeats. */
function polls(responses: Array<PageResult<PullRequestCheck>>): ReadCheckPage {
  let call = 0;
  return vi.fn(async () => responses[Math.min(call++, responses.length - 1)]!);
}

/** Runs a wait to completion with the clock under test control. */
async function run<T>(operation: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return operation;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("check wait", () => {
  it("returns at once when every check has concluded", async () => {
    const read = polls([page([check("build", false)])]);

    const { page: settled, note } = await run(waitForChecks(read, 1, 60));

    expect(settled.wait).toMatchObject({ settled: true, polls: 1, pending: [] });
    expect(settled.wait.waitedMs).toBe(0);
    expect(note).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("settles a pull request with no checks instead of waiting out the budget", async () => {
    const read = polls([page([])]);

    const { page: settled } = await run(waitForChecks(read, 1, 300));

    expect(settled.wait).toMatchObject({ settled: true, polls: 1, pending: [] });
    expect(settled.items).toEqual([]);
  });

  it("polls until the last running check concludes", async () => {
    const read = polls([
      page([check("build", true), check("lint", false)]),
      page([check("build", true), check("lint", false)]),
      page([check("build", false), check("lint", false)]),
    ]);

    const { page: settled, note } = await run(waitForChecks(read, 1, 60));

    expect(settled.wait.settled).toBe(true);
    expect(settled.wait.polls).toBe(3);
    expect(settled.wait.waitedMs).toBeGreaterThan(0);
    expect(note).toBeUndefined();
    expect(settled.items.map((item) => item.conclusion)).toEqual(["success", "success"]);
  });

  it("names what was still pending when the budget runs out", async () => {
    const read = polls([page([check("build", true), check("e2e", true), check("lint", false)])]);

    const { page: timedOut, note } = await run(waitForChecks(read, 1, 5));

    expect(timedOut.wait.settled).toBe(false);
    expect(timedOut.wait.pending).toEqual(["build", "e2e"]);
    expect(timedOut.wait.waitedMs).toBeGreaterThanOrEqual(5_000);
    expect(note).toContain("build, e2e");
    expect(note).toContain("waitSeconds");
  });

  it("keeps a long pending list out of the note", async () => {
    const running = Array.from({ length: 12 }, (_, index) => check(`job-${index + 1}`, true));
    const read = polls([page(running)]);

    const { page: timedOut, note } = await run(waitForChecks(read, 1, 5));

    expect(timedOut.wait.pending).toHaveLength(12);
    expect(note).toContain("job-10");
    expect(note).not.toContain("job-11");
    expect(note).toContain("and 2 more");
  });

  it("never waits past the budget", async () => {
    const read = polls([page([check("build", true)])]);

    const { page: timedOut } = await run(waitForChecks(read, 1, 3));

    expect(timedOut.wait.waitedMs).toBeLessThan(4_000);
  });

  it("caps a wait asked for more than the maximum", async () => {
    const read = polls([page([check("build", true)])]);

    const { page: timedOut } = await run(waitForChecks(read, 1, MAX_CHECK_WAIT_SECONDS * 10));

    expect(timedOut.wait.waitedMs).toBeLessThan((MAX_CHECK_WAIT_SECONDS + 10) * 1_000);
  });

  it("judges settlement across every page, not the one it returns", async () => {
    let call = 0;
    const read: ReadCheckPage = vi.fn(async (requested: number) => {
      const running = call < 4;
      call += 1;
      return requested === 1
        ? page([check("lint", false)], 2)
        : page([check(`e2e-${requested}`, running)]);
    });

    const { page: settled } = await run(waitForChecks(read, 1, 60));

    expect(settled.wait.settled).toBe(true);
    expect(settled.wait.polls).toBeGreaterThan(1);
    expect(settled.items.map((item) => item.name)).toEqual(["lint"]);
  });

  it("returns the requested page while scanning from the first one", async () => {
    const read: ReadCheckPage = vi.fn(async (requested: number) =>
      requested === 1 ? page([check("lint", false)], 2) : page([check("e2e", false)]),
    );

    const { page: settled } = await run(waitForChecks(read, 2, 60));

    expect(settled.items.map((item) => item.name)).toEqual(["e2e"]);
    expect(settled.wait.settled).toBe(true);
    expect(read).toHaveBeenCalledWith(1);
    expect(read).toHaveBeenCalledWith(2);
  });

  it("refuses to claim settlement for a check set larger than the scan", async () => {
    const read: ReadCheckPage = vi.fn(async (requested: number) =>
      page([check(`job-${requested}`, false)], requested + 1),
    );

    const { page: bounded, note } = await run(waitForChecks(read, 1, 60));

    expect(bounded.wait.settled).toBe(false);
    expect(bounded.wait.polls).toBe(1);
    expect(note).toContain("pages of checks");
  });
});

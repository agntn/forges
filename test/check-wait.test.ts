import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  MAX_CHECK_WAIT_SECONDS,
  waitForChecks,
  type ReadCheckPage,
  type ReadLastChange,
} from "../src/check-wait.ts";
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

/** Reports the pull request as last changed this many seconds before the wait starts. */
function changedAt(secondsAgo: number): ReadLastChange {
  const at = new Date(Date.now() - secondsAgo * 1_000).toISOString();
  return vi.fn(async () => at);
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

    const { page: settled, note } = await run(waitForChecks(read, 1, 60, changedAt(0)));

    expect(settled.wait).toMatchObject({ settled: true, polls: 1, pending: [] });
    expect(settled.wait.waitedMs).toBe(0);
    expect(note).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting through the gap between a push and its first check", async () => {
    const read = polls([
      page([]),
      page([]),
      page([check("build", true)]),
      page([check("build", false)]),
    ]);

    const { page: settled } = await run(waitForChecks(read, 1, 300, changedAt(0)));

    expect(settled.wait).toMatchObject({ settled: true, polls: 4, pending: [] });
    expect(settled.wait.noChecks).toBeUndefined();
    expect(settled.items.map((item) => item.name)).toEqual(["build"]);
  });

  it("settles at once on a pull request that sat unchanged with no checks", async () => {
    const read = polls([page([])]);

    const { page: settled, note } = await run(waitForChecks(read, 1, 300, changedAt(3_600)));

    expect(settled.wait).toMatchObject({ settled: true, polls: 1, noChecks: "quiet" });
    expect(settled.wait.waitedMs).toBe(0);
    expect(settled.items).toEqual([]);
    expect(note).toBeUndefined();
  });

  it("settles an empty list after the grace window, not after the budget", async () => {
    const read = polls([page([])]);
    const lastChange = changedAt(0);

    const { page: settled, note } = await run(waitForChecks(read, 1, 300, lastChange));

    expect(settled.wait).toMatchObject({ settled: true, noChecks: "waited" });
    expect(settled.wait.waitedMs).toBeGreaterThanOrEqual(30_000);
    expect(settled.wait.waitedMs).toBeLessThan(60_000);
    expect(note).toBeUndefined();
  });

  it("starts the window over when the pull request changes during it", async () => {
    const read = polls([page([])]);
    const before = new Date(Date.now()).toISOString();
    const after = new Date(Date.now() + 10_000).toISOString();
    let call = 0;
    const lastChange: ReadLastChange = vi.fn(async () => (call++ < 3 ? before : after));

    const { page: settled } = await run(waitForChecks(read, 1, 300, lastChange));

    expect(settled.wait).toMatchObject({ settled: true, noChecks: "waited" });
    expect(settled.wait.waitedMs).toBeGreaterThanOrEqual(12_000 + 30_000);
  });

  it("gives a push that empties the list mid wait its own window", async () => {
    const read = polls([
      page([check("build", true)]),
      page([check("build", true)]),
      page([check("build", true)]),
      page([]),
    ]);
    const pushedAt = new Date(Date.now() + 10_000).toISOString();

    const { page: settled } = await run(
      waitForChecks(
        read,
        1,
        300,
        vi.fn(async () => pushedAt),
      ),
    );

    expect(settled.wait).toMatchObject({ settled: true, noChecks: "waited" });
    expect(settled.wait.waitedMs).toBeGreaterThanOrEqual(12_000 + 30_000);
  });

  it("starts the window over instead of failing when the last change can't be read", async () => {
    const read = polls([page([])]);
    const at = new Date(Date.now()).toISOString();
    let call = 0;
    const lastChange: ReadLastChange = vi.fn(async () => {
      if (call++ === 3) throw new Error("rate limited");
      return at;
    });

    const { page: settled } = await run(waitForChecks(read, 1, 300, lastChange));

    expect(settled.wait).toMatchObject({ settled: true, noChecks: "waited" });
    expect(settled.wait.waitedMs).toBeGreaterThanOrEqual(12_000 + 30_000);
  });

  it("does not call an empty list final when the budget ends inside the grace window", async () => {
    const read = polls([page([])]);

    const { page: timedOut, note } = await run(waitForChecks(read, 1, 5, changedAt(0)));

    expect(timedOut.wait.settled).toBe(false);
    expect(timedOut.wait.noChecks).toBeUndefined();
    expect(note).toContain("No check has shown up");
    expect(note).toContain("waitSeconds");
  });

  it("polls until the last running check concludes", async () => {
    const read = polls([
      page([check("build", true), check("lint", false)]),
      page([check("build", true), check("lint", false)]),
      page([check("build", false), check("lint", false)]),
    ]);

    const { page: settled, note } = await run(waitForChecks(read, 1, 60, changedAt(0)));

    expect(settled.wait.settled).toBe(true);
    expect(settled.wait.polls).toBe(3);
    expect(settled.wait.waitedMs).toBeGreaterThan(0);
    expect(note).toBeUndefined();
    expect(settled.items.map((item) => item.conclusion)).toEqual(["success", "success"]);
  });

  it("names what was still pending when the budget runs out", async () => {
    const read = polls([page([check("build", true), check("e2e", true), check("lint", false)])]);

    const { page: timedOut, note } = await run(waitForChecks(read, 1, 5, changedAt(0)));

    expect(timedOut.wait.settled).toBe(false);
    expect(timedOut.wait.pending).toEqual(["build", "e2e"]);
    expect(timedOut.wait.waitedMs).toBeGreaterThanOrEqual(5_000);
    expect(note).toContain("build, e2e");
    expect(note).toContain("waitSeconds");
  });

  it("keeps a long pending list out of the note", async () => {
    const running = Array.from({ length: 12 }, (_, index) => check(`job-${index + 1}`, true));
    const read = polls([page(running)]);

    const { page: timedOut, note } = await run(waitForChecks(read, 1, 5, changedAt(0)));

    expect(timedOut.wait.pending).toHaveLength(12);
    expect(note).toContain("job-10");
    expect(note).not.toContain("job-11");
    expect(note).toContain("and 2 more");
  });

  it("never waits past the budget", async () => {
    const read = polls([page([check("build", true)])]);

    const { page: timedOut } = await run(waitForChecks(read, 1, 3, changedAt(0)));

    expect(timedOut.wait.waitedMs).toBeLessThan(4_000);
  });

  it("caps a wait asked for more than the maximum", async () => {
    const read = polls([page([check("build", true)])]);

    const { page: timedOut } = await run(
      waitForChecks(read, 1, MAX_CHECK_WAIT_SECONDS * 10, changedAt(0)),
    );

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

    const { page: settled } = await run(waitForChecks(read, 1, 60, changedAt(0)));

    expect(settled.wait.settled).toBe(true);
    expect(settled.wait.polls).toBeGreaterThan(1);
    expect(settled.items.map((item) => item.name)).toEqual(["lint"]);
  });

  it("returns the requested page while scanning from the first one", async () => {
    const read: ReadCheckPage = vi.fn(async (requested: number) =>
      requested === 1 ? page([check("lint", false)], 2) : page([check("e2e", false)]),
    );

    const { page: settled } = await run(waitForChecks(read, 2, 60, changedAt(0)));

    expect(settled.items.map((item) => item.name)).toEqual(["e2e"]);
    expect(settled.wait.settled).toBe(true);
    expect(read).toHaveBeenCalledWith(1);
    expect(read).toHaveBeenCalledWith(2);
  });

  it("refuses to claim settlement for a check set larger than the scan", async () => {
    const read: ReadCheckPage = vi.fn(async (requested: number) =>
      page([check(`job-${requested}`, false)], requested + 1),
    );

    const { page: bounded, note } = await run(waitForChecks(read, 1, 60, changedAt(0)));

    expect(bounded.wait.settled).toBe(false);
    expect(bounded.wait.polls).toBe(1);
    expect(note).toContain("pages of checks");
  });
});

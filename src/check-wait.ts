import type { PageResult, PullRequestCheck } from "./types.ts";

/**
 * The longest one call may wait, matching the bound `@agntn/memory` puts on its
 * recall wait. The tool schemas repeat the number, because they are built with
 * TypeBox in the published extension packages and cannot import from `src/`.
 */
export const MAX_CHECK_WAIT_SECONDS = 300;

const POLL_STEP_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 10_000;
/**
 * A poll reads every page before it calls the run finished, so the scan needs a
 * bound of its own: a repository with more checks than this reports what it saw
 * rather than claiming a settlement it never proved.
 */
const MAX_SCAN_PAGES = 20;
/** A long pending list belongs in the payload, not repeated in full in the note. */
const NOTE_PENDING_LIMIT = 10;

/** What one bounded wait did, reported next to the page it returns. */
export interface CheckWait {
  /** True only when every check of the pull request reached a conclusion. */
  settled: boolean;
  waitedMs: number;
  polls: number;
  /** Names of the checks that had not concluded when the wait ended. */
  pending: string[];
}

export type WaitedCheckPage = PageResult<PullRequestCheck> & { wait: CheckWait };

/** Reads one page of checks; the wait calls it repeatedly with the same page size. */
export type ReadCheckPage = (page: number) => Promise<PageResult<PullRequestCheck>>;

export interface CheckWaitResult {
  page: WaitedCheckPage;
  /** The one thing a caller has to act on, or nothing when the run concluded. */
  note: string | undefined;
}

interface Scan {
  requested: PageResult<PullRequestCheck>;
  pending: string[];
  /** False when the check set outran the scan bound, so settlement cannot be claimed. */
  examinedEveryPage: boolean;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Reads the whole check set once and keeps the page the caller asked for.
 *
 * Settlement is judged across every page rather than the returned one: a
 * pull request whose first page is green while a later page still runs is not
 * finished, and reporting it as finished is the mistake a hand-rolled loop makes.
 */
async function scanChecks(read: ReadCheckPage, requestedPage: number): Promise<Scan> {
  let requested: PageResult<PullRequestCheck> | undefined;
  const pending: string[] = [];
  let page = 1;
  let examinedEveryPage = false;

  for (let visited = 0; visited < MAX_SCAN_PAGES; visited += 1) {
    const result = await read(page);
    if (page === requestedPage) requested = result;
    for (const check of result.items) {
      if (check.status !== "completed") pending.push(check.name);
    }
    if (!result.hasNextPage) {
      examinedEveryPage = true;
      break;
    }
    page = result.nextPage ?? page + 1;
  }

  return { requested: requested ?? (await read(requestedPage)), pending, examinedEveryPage };
}

function pendingText(pending: string[]): string {
  const named = pending.slice(0, NOTE_PENDING_LIMIT).join(", ");
  const rest = pending.length - NOTE_PENDING_LIMIT;
  return rest > 0 ? `${named} and ${rest} more` : named;
}

function waitNote(
  wait: CheckWait,
  examinedEveryPage: boolean,
  waitSeconds: number,
): string | undefined {
  if (wait.settled) return undefined;
  if (!examinedEveryPage) {
    return `The wait stopped after ${MAX_SCAN_PAGES} pages of checks without reaching the end of the set; read the remaining pages before treating this pull request as finished.`;
  }
  return `Checks were still running when the ${waitSeconds}s budget ran out: ${pendingText(wait.pending)}. Call again with waitSeconds to keep waiting; do not treat the pull request as finished.`;
}

/**
 * Polls one pull request's checks until every one concludes or the budget ends.
 *
 * A pull request with no checks settles on the first read instead of waiting the
 * budget out, and a timeout is an ordinary result carrying the names that were
 * still running, because an error would cost the caller the state it asked for.
 */
export async function waitForChecks(
  read: ReadCheckPage,
  requestedPage: number,
  waitSeconds: number,
): Promise<CheckWaitResult> {
  const budgetMs = Math.min(waitSeconds, MAX_CHECK_WAIT_SECONDS) * 1_000;
  const startedAt = performance.now();
  let polls = 0;

  while (true) {
    polls += 1;
    const scan = await scanChecks(read, requestedPage);
    const waitedMs = Math.round(performance.now() - startedAt);
    const settled = scan.examinedEveryPage && scan.pending.length === 0;
    const remainingMs = budgetMs - waitedMs;

    if (settled || !scan.examinedEveryPage || remainingMs <= 0) {
      const wait: CheckWait = { settled, waitedMs, polls, pending: scan.pending };
      return {
        page: { ...scan.requested, wait },
        note: waitNote(wait, scan.examinedEveryPage, waitSeconds),
      };
    }

    await delay(Math.min(polls * POLL_STEP_MS, MAX_POLL_INTERVAL_MS, remainingMs));
  }
}

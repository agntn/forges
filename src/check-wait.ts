import { delay, MAX_SCAN_PAGES, MAX_WAIT_SECONDS, nextPollDelay, untilAborted } from "./poll.ts";
import type { PageResult, PullRequestCheck } from "./types.ts";

export { MAX_WAIT_SECONDS as MAX_CHECK_WAIT_SECONDS };

/** A long pending list belongs in the payload, not repeated in full in the note. */
const NOTE_PENDING_LIMIT = 10;
/** CI lists a fresh head seconds after the push, so an empty list proves nothing before this. */
export const EMPTY_CHECK_GRACE_SECONDS = 30;
const EMPTY_GRACE_MS = EMPTY_CHECK_GRACE_SECONDS * 1_000;

/** What one bounded wait did, reported next to the page it returns. */
export interface CheckWait {
  /** True once every check concluded, or once no check showed up within the grace window. */
  settled: boolean;
  waitedMs: number;
  polls: number;
  /** Names of the checks that had not concluded when the wait ended. */
  pending: string[];
  /** Why an empty list settled: the pull request was already quiet, or the wait sat it out. */
  noChecks?: "quiet" | "waited";
}

/** A page of checks, or an empty one naming the commit the pull request still points at. */
export type CheckPage = PageResult<PullRequestCheck> & { staleHead?: string };

export type WaitedCheckPage = CheckPage & { wait: CheckWait };

/** Reads one page of checks at a cursor; the wait calls it repeatedly with the same page size. */
export type ReadCheckPage = (cursor: string | undefined) => Promise<PageResult<PullRequestCheck>>;

/** Reads when the pull request last changed; a push moves it on GitHub, GitLab and Gitea. */
export type ReadLastChange = () => Promise<string>;

/** The commit the caller just pushed, and a read of the one the pull request points at now. */
export interface ExpectedHead {
  sha: string;
  read: () => Promise<string>;
}

/** A pull request that hasn't caught up with a push: where it points, and what was pushed. */
interface StaleHead {
  current: string;
  expected: string;
}

/** The page to read, and the push the pull request has to point at first. */
export interface CheckReadOptions {
  cursor?: string;
  expectedHead?: ExpectedHead;
}

/** How long to wait, and what tells a quiet pull request from a fresh push. */
export interface CheckWaitOptions extends CheckReadOptions {
  waitSeconds: number;
  readLastChange: ReadLastChange;
  /** The host's cancel: an aborted wait rejects with its reason instead of polling on. */
  signal?: AbortSignal;
}

export interface CheckWaitResult {
  page: WaitedCheckPage;
  /** The one thing a caller has to act on, or nothing when the run concluded. */
  note: string | undefined;
}

/** A run of empty reads under one last change; another change starts a new one. */
interface EmptyRun {
  sinceMs: number;
  changedAt: string | undefined;
  quiet: boolean;
}

interface Scan {
  requested: PageResult<PullRequestCheck>;
  checks: number;
  pending: string[];
  /** False when the check set outran the scan bound, so settlement cannot be claimed. */
  examinedEveryPage: boolean;
}

/**
 * Reads the whole check set once and keeps the page the caller asked for.
 *
 * Settlement is judged across every page rather than the returned one: a
 * pull request whose first page is green while a later page still runs is not
 * finished, and reporting it as finished is the mistake a hand-rolled loop makes.
 */
async function scanChecks(read: ReadCheckPage, requestedCursor: string | undefined): Promise<Scan> {
  let requested: PageResult<PullRequestCheck> | undefined;
  let checks = 0;
  const pending: string[] = [];
  let cursor: string | undefined;
  let examinedEveryPage = false;

  for (let visited = 0; visited < MAX_SCAN_PAGES; visited += 1) {
    const result = await read(cursor);
    if (cursor === requestedCursor) requested = result;
    checks += result.items.length;
    for (const check of result.items) {
      if (check.status !== "completed") pending.push(check.name);
    }
    if (result.nextCursor === undefined) {
      examinedEveryPage = true;
      break;
    }
    cursor = result.nextCursor;
  }

  return {
    requested: requested ?? (await read(requestedCursor)),
    checks,
    pending,
    examinedEveryPage,
  };
}

/** A failed read comes back as unknown, never as an error that would cost the answer. */
async function lastChangeOrNothing(readLastChange: ReadLastChange): Promise<string | undefined> {
  try {
    return await readLastChange();
  } catch {
    return undefined;
  }
}

/** A future date or one that doesn't parse counts as a change just now. */
function quietForGrace(changedAt: string | undefined): boolean {
  return changedAt !== undefined && Date.now() - Date.parse(changedAt) >= EMPTY_GRACE_MS;
}

/** Keeps the run while the last change holds; a move or an unknown read starts it over. */
function continueEmptyRun(
  run: EmptyRun | undefined,
  seen: { changedAt: string | undefined; waitedMs: number },
): EmptyRun {
  const { changedAt, waitedMs } = seen;
  if (run && changedAt !== undefined && changedAt === run.changedAt) return run;
  return {
    sinceMs: waitedMs,
    changedAt: changedAt ?? run?.changedAt,
    quiet: quietForGrace(changedAt),
  };
}

function pendingText(pending: string[]): string {
  const named = pending.slice(0, NOTE_PENDING_LIMIT).join(", ");
  const rest = pending.length - NOTE_PENDING_LIMIT;
  return rest > 0 ? `${named} and ${rest} more` : named;
}

function waitNote(
  wait: CheckWait,
  scan: { examinedEveryPage: boolean; waitSeconds: number },
): string | undefined {
  const { examinedEveryPage, waitSeconds } = scan;
  if (wait.settled) return undefined;
  if (!examinedEveryPage) {
    return `The wait stopped after ${MAX_SCAN_PAGES} pages of checks without reaching the end of the set; read the remaining pages before treating this pull request as finished.`;
  }
  if (wait.pending.length === 0) {
    return `No check has shown up for this head within the ${waitSeconds}s budget, which is too soon to call it final: CI may still be starting. Call again with waitSeconds; do not treat the pull request as finished.`;
  }
  return `Checks were still running when the ${waitSeconds}s budget ran out: ${pendingText(wait.pending)}. Call again with waitSeconds to keep waiting; do not treat the pull request as finished.`;
}

/** Forges answer with lowercase hex, while a caller may pass the same SHA in capitals. */
async function findStaleHead(expected: ExpectedHead | undefined): Promise<StaleHead | undefined> {
  if (expected === undefined) return undefined;
  const current = await expected.read();
  const same = current.toLowerCase() === expected.sha.toLowerCase();
  return same ? undefined : { current, expected: expected.sha };
}

/** Providers reread the head for every check list, so a push landing mid read must void it. */
async function readAtHead<T>(
  expectedHead: ExpectedHead | undefined,
  read: () => Promise<T>,
): Promise<{ stale: StaleHead } | { stale: undefined; value: T }> {
  const before = await findStaleHead(expectedHead);
  if (before) return { stale: before };
  const value = await read();
  const after = await findStaleHead(expectedHead);
  return after ? { stale: after } : { stale: undefined, value };
}

/** Reads the checks once, or none while the pull request still lags behind the push. */
export async function readChecks(
  read: ReadCheckPage,
  options: CheckReadOptions = {},
): Promise<{ page: CheckPage; note: string | undefined }> {
  const { cursor: requestedCursor, expectedHead } = options;
  const outcome = await readAtHead(expectedHead, () => read(requestedCursor));
  if (outcome.stale) {
    return { page: staleHeadPage(outcome.stale), note: staleHeadNote(outcome.stale) };
  }
  return { page: outcome.value, note: undefined };
}

function staleHeadPage(stale: Readonly<StaleHead>): CheckPage {
  return { items: [], staleHead: stale.current };
}

function staleHeadNote(stale: Readonly<StaleHead>, waitSeconds?: number): string {
  const when = waitSeconds === undefined ? "" : ` after ${waitSeconds}s`;
  return `The pull request still points at ${stale.current}${when}, not at headSha ${stale.expected}, so that commit's checks are left out. The forge may not have caught up with the push yet: call again with waitSeconds. If ${stale.expected} isn't the latest push, pass the head the pull request reports instead.`;
}

/**
 * Polls one pull request's checks until every one concludes or the budget ends.
 *
 * An empty list right after a push looks just like a pull request without CI, so it
 * settles at once only when the pull request was already quiet, and otherwise once it
 * stays empty for the grace window, which any change to the pull request starts over.
 * With an expected head, a pull request still pointing at the previous push never settles.
 * A timeout is an ordinary result carrying the names that were still running,
 * because an error would cost the caller the state it asked for.
 */
export async function waitForChecks(
  read: ReadCheckPage,
  options: CheckWaitOptions,
): Promise<CheckWaitResult> {
  const { cursor: requestedCursor, waitSeconds, readLastChange, expectedHead, signal } = options;
  const readPage = untilAborted(read, signal);
  const budgetMs = Math.min(waitSeconds, MAX_WAIT_SECONDS) * 1_000;
  const startedAt = performance.now();
  let polls = 0;
  let emptyRun: EmptyRun | undefined;

  while (true) {
    polls += 1;
    const outcome = await readAtHead(expectedHead, () => scanChecks(readPage, requestedCursor));
    const stale = outcome.stale;
    if (stale) {
      emptyRun = undefined;
      const waitedMs = Math.round(performance.now() - startedAt);
      if (waitedMs >= budgetMs) {
        const wait: CheckWait = { settled: false, waitedMs, polls, pending: [] };
        return { page: { ...staleHeadPage(stale), wait }, note: staleHeadNote(stale, waitSeconds) };
      }
      await delay(nextPollDelay(polls, budgetMs - waitedMs), signal);
      continue;
    }
    const scan = outcome.value;
    const waitedMs = Math.round(performance.now() - startedAt);
    const empty = scan.examinedEveryPage && scan.checks === 0;
    let noChecks: CheckWait["noChecks"];
    if (empty) {
      const changedAt = await lastChangeOrNothing(readLastChange);
      emptyRun = continueEmptyRun(emptyRun, { changedAt, waitedMs });
      if (emptyRun.quiet) noChecks = "quiet";
      else if (waitedMs - emptyRun.sinceMs >= EMPTY_GRACE_MS) noChecks = "waited";
    } else {
      emptyRun = undefined;
    }
    const settled = empty
      ? noChecks !== undefined
      : scan.examinedEveryPage && scan.pending.length === 0;
    const remainingMs = budgetMs - waitedMs;

    if (settled || !scan.examinedEveryPage || remainingMs <= 0) {
      const wait: CheckWait = { settled, waitedMs, polls, pending: scan.pending };
      if (noChecks) wait.noChecks = noChecks;
      return {
        page: { ...scan.requested, wait },
        note: waitNote(wait, { examinedEveryPage: scan.examinedEveryPage, waitSeconds }),
      };
    }

    await delay(nextPollDelay(polls, remainingMs), signal);
  }
}

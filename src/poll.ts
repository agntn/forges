import type { ToolCallContext } from "@agntn/tools";

/**
 * The longest one call may wait, matching the bound `@agntn/memory` puts on its
 * recall wait. The tool schemas repeat the number, because they are built with
 * TypeBox in the published extension packages and cannot import from `src/`.
 */
export const MAX_WAIT_SECONDS = 300;

/**
 * A poll reads every page before it calls a wait settled, so the scan needs a
 * bound of its own: a set longer than this reports what it saw rather than
 * claiming a settlement it never proved.
 */
export const MAX_SCAN_PAGES = 20;

const POLL_STEP_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 10_000;

/** Claude Code drops a call after 60 quiet seconds, so this leaves room for a lost update or two. */
const PROGRESS_INTERVAL_MS = 15_000;

/** The host's progress callback, absent where nothing can show it. */
export type WaitProgress = ToolCallContext["progress"];

/** What a wait reports while it polls: a fixed line and the seconds it was given. */
export interface WaitReport {
  readonly progress: WaitProgress;
  readonly message: string;
  readonly waitSeconds: number;
}

/** Sleeps between polls, and rejects with the signal's reason the moment the caller gives up. */
export function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, milliseconds);
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
  });
}

/** Wraps a page read so a cancelled wait stops before its next request, not after its scan. */
export function untilAborted<T>(
  read: (cursor: string | undefined) => Promise<T>,
  signal: AbortSignal | undefined,
): (cursor: string | undefined) => Promise<T> {
  if (signal === undefined) return read;
  return (cursor) => {
    signal.throwIfAborted();
    return read(cursor);
  };
}

/** Two seconds after the first read, then two more each time, up to ten. */
export function nextPollDelay(polls: number, remainingMs: number): number {
  return Math.min(polls * POLL_STEP_MS, MAX_POLL_INTERVAL_MS, remainingMs);
}

/**
 * Runs a wait while telling the host every 15 seconds how much of its budget has gone.
 *
 * A poll that finds nothing says nothing, and a client with an idle timeout reads that
 * silence as a dead call, so the heartbeat runs on its own timer rather than per poll.
 *
 * @param report - The host's callback and what to tell it.
 * @param wait - The polling loop; its result and rejection pass through untouched.
 * @returns {Promise<T>} Whatever the wait returns.
 */
export async function reportWhileWaiting<T>(
  report: WaitReport,
  wait: () => Promise<T>,
): Promise<T> {
  const { progress, message } = report;
  if (progress === undefined) return wait();
  const total = Math.min(report.waitSeconds, MAX_WAIT_SECONDS);
  const startedAt = performance.now();
  const tick = (): void => {
    const waited = Math.round((performance.now() - startedAt) / 1_000);
    progress(message, { progress: Math.min(waited, total), total });
  };
  tick();
  const timer = setInterval(tick, PROGRESS_INTERVAL_MS);
  try {
    return await wait();
  } finally {
    clearInterval(timer);
  }
}

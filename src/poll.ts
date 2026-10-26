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

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** Two seconds after the first read, then two more each time, up to ten. */
export function nextPollDelay(polls: number, remainingMs: number): number {
  return Math.min(polls * POLL_STEP_MS, MAX_POLL_INTERVAL_MS, remainingMs);
}

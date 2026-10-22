import { ForgesError } from "./errors.ts";

/** What one slice of a file, patch, job log or release notes holds unless asked otherwise. */
export const DEFAULT_WINDOW_CHARS = 20_000;
/** The most one slice holds, so a single tool answer can't swallow the context. */
export const MAX_WINDOW_CHARS = 200_000;

/** Where a slice starts and how much it may hold, in UTF-16 code units. */
export interface TextWindowOptions {
  offset?: number;
  maxChars?: number;
}

/** A checked window with its defaults filled in. */
export interface TextWindow {
  offset: number;
  maxChars: number;
}

/** What a window refusal names: the text it slices and the platform it came from. */
export interface TextWindowSubject {
  subject: string;
  platform?: string;
}

/** Check a window before provider I/O and fill in its defaults; `subject` opens every refusal. */
export function readTextWindow(options: TextWindowOptions, about: TextWindowSubject): TextWindow {
  const { subject, platform } = about;
  const offset = options.offset ?? 0;
  const maxChars = options.maxChars ?? DEFAULT_WINDOW_CHARS;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ForgesError(`${subject} offset must be a non-negative integer`, {
      status: 400,
      platform,
    });
  }
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > MAX_WINDOW_CHARS) {
    throw new ForgesError(`${subject} maxChars must be an integer from 1 to ${MAX_WINDOW_CHARS}`, {
      status: 400,
      platform,
    });
  }
  if (!Number.isSafeInteger(offset + maxChars)) {
    throw new ForgesError(`${subject} range exceeds the safe integer limit`, {
      status: 400,
      platform,
    });
  }
  return { offset, maxChars };
}

/** How long the text is, and the refusal an offset past its end gets. */
export interface TextLength {
  length: number;
  pastEnd: string;
  platform?: string;
}

/** Where a window over `length` code units stops; an offset past the end gets `pastEnd`. */
export function textWindowEnd(
  window: TextWindow,
  text: TextLength,
): { end: number; nextOffset: number | null; truncated: boolean } {
  const { length, pastEnd, platform } = text;
  if (window.offset > length) throw new ForgesError(pastEnd, { status: 400, platform });
  const end = Math.min(window.offset + window.maxChars, length);
  return { end, nextOffset: end < length ? end : null, truncated: end < length };
}

import { ForgesError } from "./errors.ts";
import type { Release } from "./types.ts";

export const DEFAULT_RELEASE_NOTES_MAX_CHARS = 20_000;
export const MAX_RELEASE_NOTES_CHARS = 200_000;

/** How much of the release notes one tool read returns. */
export interface ReleaseNotesOptions {
  offset?: number;
  maxChars?: number;
}

/** A release with one slice of its notes in body. Same tag plus nextOffset reads the next one. */
export interface ReleaseNotesSlice extends Release {
  offset: number;
  nextOffset: number | null;
  truncated: boolean;
  /** Length of the whole notes, so an agent knows how many reads are left before it starts. */
  length: number;
}

/** Validate the notes window before provider I/O. */
export function assertReleaseNotesOptions(
  options: ReleaseNotesOptions = {},
  platform?: string,
): void {
  const offset = options.offset ?? 0;
  const maxChars = options.maxChars ?? DEFAULT_RELEASE_NOTES_MAX_CHARS;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ForgesError("Release notes offset must be a non-negative integer", 400, platform);
  }
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > MAX_RELEASE_NOTES_CHARS) {
    throw new ForgesError(
      `Release notes maxChars must be an integer from 1 to ${MAX_RELEASE_NOTES_CHARS}`,
      400,
      platform,
    );
  }
  if (!Number.isSafeInteger(offset + maxChars)) {
    throw new ForgesError("Release notes range exceeds the safe integer limit", 400, platform);
  }
}

/** Cut one slice of the notes. Everything else about the release rides along untouched. */
export function sliceReleaseNotes(
  release: Release,
  options: ReleaseNotesOptions = {},
  platform?: string,
): ReleaseNotesSlice {
  assertReleaseNotesOptions(options, platform);
  const offset = options.offset ?? 0;
  const maxChars = options.maxChars ?? DEFAULT_RELEASE_NOTES_MAX_CHARS;
  const length = release.body.length;
  if (offset > length) {
    throw new ForgesError("Release notes offset is past the end of the notes", 400, platform);
  }
  const end = Math.min(offset + maxChars, length);
  return {
    ...release,
    body: release.body.slice(offset, end),
    offset,
    nextOffset: end < length ? end : null,
    truncated: end < length,
    length,
  };
}

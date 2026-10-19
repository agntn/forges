import { Buffer } from "node:buffer";
import { sha256 } from "@agntn/hashes/sha2";
import { ForgesError } from "./errors.ts";
import { readTextWindow, textWindowEnd, type TextWindow } from "./text-window.ts";
import type { Release } from "./types.ts";

const NOTES_HASH = /^[0-9a-f]{16}$/u;

/** How much of the release notes one tool read returns. */
export interface ReleaseNotesOptions {
  offset?: number;
  maxChars?: number;
  notesHash?: string;
}

/** A release with one slice of its notes in body. Same tag plus nextOffset reads the next one. */
export interface ReleaseNotesSlice extends Release {
  offset: number;
  nextOffset: number | null;
  truncated: boolean;
  /** Length of the whole notes, so an agent knows how many reads are left before it starts. */
  length: number;
  /** Fingerprint of the whole notes. Handing it back stops an edit splicing two versions. */
  notesHash: string;
}

/** Validate the notes window before provider I/O. */
export function assertReleaseNotesOptions(
  options: ReleaseNotesOptions = {},
  platform?: string,
): TextWindow {
  const window = readTextWindow(options, { subject: "Release notes", platform });
  if (options.notesHash !== undefined && !NOTES_HASH.test(options.notesHash)) {
    throw new ForgesError(
      "Release notes notesHash must be the 16 hex digits a previous read returned",
      400,
      platform,
    );
  }
  if (window.offset > 0 && options.notesHash === undefined) {
    throw new ForgesError(
      "Release notes offset needs the notesHash of the read it continues",
      400,
      platform,
    );
  }
  return window;
}

/** First 8 bytes of the notes' SHA-256 in hex, plenty to notice an edit between two reads. */
export function hashReleaseNotes(body: string): string {
  return Buffer.from(sha256(new TextEncoder().encode(body))).toString("hex", 0, 8);
}

/** Cut one slice of the notes. Everything else about the release rides along untouched. */
export function sliceReleaseNotes(
  release: Release,
  options: ReleaseNotesOptions & { platform?: string } = {},
): ReleaseNotesSlice {
  const { platform } = options;
  const window = assertReleaseNotesOptions(options, platform);
  const notesHash = hashReleaseNotes(release.body);
  if (options.notesHash !== undefined && options.notesHash !== notesHash) {
    throw new ForgesError(
      "Release notes changed since the read that returned this notesHash. Read again from offset 0",
      409,
      platform,
    );
  }
  const { length } = release.body;
  const { end, nextOffset, truncated } = textWindowEnd(window, {
    length,
    pastEnd: "Release notes offset is past the end of the notes",
    platform,
  });
  return {
    ...release,
    body: release.body.slice(window.offset, end),
    offset: window.offset,
    nextOffset,
    truncated,
    length,
    notesHash,
  };
}

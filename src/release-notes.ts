import { assertBodyWindow, hashBody, sliceBody, type BodySubject } from "./body-window.ts";
import type { TextWindow } from "./text-window.ts";
import type { Release } from "./types.ts";

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

function releaseNotes(platform?: string): BodySubject {
  return { subject: "Release notes", noun: "notes", hashName: "notesHash", platform };
}

/** Validate the notes window before provider I/O. */
export function assertReleaseNotesOptions(
  options: ReleaseNotesOptions = {},
  platform?: string,
): TextWindow {
  const { offset, maxChars, notesHash } = options;
  return assertBodyWindow({ offset, maxChars, hash: notesHash }, releaseNotes(platform));
}

/** First 8 bytes of the notes' SHA-256 in hex, plenty to notice an edit between two reads. */
export const hashReleaseNotes = hashBody;

/** Cut one slice of the notes. Everything else about the release rides along untouched. */
export function sliceReleaseNotes(
  release: Release,
  options: ReleaseNotesOptions & { platform?: string } = {},
): ReleaseNotesSlice {
  const { offset, maxChars, notesHash, platform } = options;
  const { hash, ...window } = sliceBody(release.body, {
    offset,
    maxChars,
    hash: notesHash,
    about: releaseNotes(platform),
  });
  return { ...release, ...window, notesHash: hash };
}

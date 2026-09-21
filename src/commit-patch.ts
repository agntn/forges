import { ForgesError } from "./errors.ts";
import type {
  CommitPatch,
  CommitPatchFile,
  CommitPatchOptions,
  CommitPatchState,
} from "./types.ts";

export const DEFAULT_PATCH_MAX_CHARS = 20_000;
export const MAX_PATCH_CHARS = 200_000;

/** Validate patch selection and output bounds before provider I/O. */
export function assertCommitPatchOptions(options: CommitPatchOptions = {}): void {
  const offset = options.offset ?? 0;
  const maxChars = options.maxChars ?? DEFAULT_PATCH_MAX_CHARS;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ForgesError("Commit patch offset must be a non-negative integer", 400);
  }
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > MAX_PATCH_CHARS) {
    throw new ForgesError(
      `Commit patch maxChars must be an integer from 1 to ${MAX_PATCH_CHARS}`,
      400,
    );
  }
  if (!Number.isSafeInteger(offset + maxChars)) {
    throw new ForgesError("Commit patch range exceeds the safe integer limit", 400);
  }
  if (options.path !== undefined && options.path.length === 0) {
    throw new ForgesError("Commit patch path must not be empty", 400);
  }
}

function fileHeader(file: CommitPatchFile): string {
  const previous = file.previousPath === null ? "" : ` from ${file.previousPath}`;
  return `--- ${file.status} ${file.path}${previous}\n`;
}

function fileBody(file: CommitPatchFile): string {
  if (file.state === "binary") return "[binary patch omitted]\n";
  if (file.state === "unavailable") return "[patch unavailable from provider]\n";
  return file.patch.endsWith("\n") ? file.patch : `${file.patch}\n`;
}

/** Render provider patch rows into one stable, bounded continuation stream. */
export function buildCommitPatch(
  sha: string,
  files: readonly CommitPatchFile[],
  filesComplete: boolean | null,
  options: CommitPatchOptions = {},
): CommitPatch {
  assertCommitPatchOptions(options);
  const offset = options.offset ?? 0;
  const maxChars = options.maxChars ?? DEFAULT_PATCH_MAX_CHARS;

  const states: Record<CommitPatchState, number> = { included: 0, binary: 0, unavailable: 0 };
  const chunks: string[] = [];
  const requestedEnd = offset + maxChars;
  let streamLength = 0;
  for (const file of files) {
    if (options.path !== undefined && file.path !== options.path) continue;
    states[file.state] += 1;
    const segment = `${fileHeader(file)}${fileBody(file)}`;
    const segmentStart = streamLength;
    const segmentEnd = segmentStart + segment.length;
    if (segmentEnd > offset && segmentStart < requestedEnd) {
      chunks.push(segment.slice(Math.max(0, offset - segmentStart), requestedEnd - segmentStart));
    }
    streamLength = segmentEnd;
  }
  if (offset > streamLength) {
    throw new ForgesError("Commit patch offset is past the end of the resolved patch", 400);
  }

  const end = Math.min(requestedEnd, streamLength);
  return {
    sha,
    path: options.path ?? null,
    content: chunks.join(""),
    offset,
    nextOffset: end < streamLength ? end : null,
    truncated: end < streamLength,
    filesComplete,
    states,
  };
}

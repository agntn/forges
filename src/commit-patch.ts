import { ForgesError } from "./errors.ts";
import { readTextWindow, textWindowEnd, type TextWindow } from "./text-window.ts";
import type {
  CommitPatch,
  CommitPatchFile,
  CommitPatchOptions,
  CommitPatchState,
} from "./types.ts";

/** Validate patch selection and output bounds before provider I/O. */
export function assertCommitPatchOptions(
  options: CommitPatchOptions = {},
  platform?: string,
): TextWindow {
  const window = readTextWindow("Commit patch", options, platform);
  if (options.path !== undefined && options.path.length === 0) {
    throw new ForgesError("Commit patch path must not be empty", 400, platform);
  }
  return window;
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
  const window = assertCommitPatchOptions(options);
  const { offset } = window;

  const states: Record<CommitPatchState, number> = { included: 0, binary: 0, unavailable: 0 };
  const chunks: string[] = [];
  const requestedEnd = offset + window.maxChars;
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
  const { nextOffset, truncated } = textWindowEnd(
    streamLength,
    window,
    "Commit patch offset is past the end of the resolved patch",
  );
  return {
    sha,
    path: options.path ?? null,
    content: chunks.join(""),
    offset,
    nextOffset,
    truncated,
    filesComplete,
    states,
  };
}

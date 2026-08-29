import type { ChangedFileStatus } from "./types.ts";

/** Normalize provider-specific changed-file states. */
export function normalizeChangedFileStatus(status: string): ChangedFileStatus {
  switch (status) {
    case "added":
      return "added";
    case "removed":
    case "deleted":
      return "removed";
    case "renamed":
      return "renamed";
    case "copied":
      return "copied";
    case "changed":
    case "modified":
      return "modified";
    default:
      return "unknown";
  }
}

/** Count changed content lines in a unified diff, excluding file headers. */
export function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  let insideHunk = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      insideHunk = true;
      continue;
    }
    if (!insideHunk) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }

  return { additions, deletions };
}

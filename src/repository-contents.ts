import { Buffer } from "node:buffer";
import { ForgesError } from "./errors.ts";
import { encodeApiResponsePathSegment } from "./providers/base-url.ts";
import { readTextWindow, textWindowEnd, type TextWindow } from "./text-window.ts";
import type {
  RepositoryContentsOptions,
  RepositoryEntryType,
  RepositoryFileContents,
} from "./types.ts";

/** Largest file a read decodes. GitHub's contents API stops returning content above it. */
export const MAX_FILE_BYTES = 1_048_576;

/** Git's own heuristic: a NUL byte in the first 8000 bytes makes a file binary. */
const BINARY_PROBE_BYTES = 8000;
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** Validate slice bounds before provider I/O. */
export function assertRepositoryContentsOptions(
  options: RepositoryContentsOptions = {},
  platform?: string,
): TextWindow {
  const window = readTextWindow(options, { subject: "File", platform });
  if (options.ref !== undefined && options.ref.length === 0) {
    throw new ForgesError("File ref must not be empty", 400, platform);
  }
  return window;
}

/** Trim outer slashes and refuse segments like `..`; an empty result is the root. */
export function normalizeRepositoryPath(path: string, platform?: string): string {
  const trimmed = path.replace(/^\/+|\/+$/gu, "");
  if (trimmed === "") return "";
  try {
    for (const segment of trimmed.split("/")) encodeApiResponsePathSegment(segment);
  } catch {
    throw new ForgesError(`Invalid repository path: ${path}`, 400, platform);
  }
  return trimmed;
}

/** Encode a normalized repository path for a URL, one segment at a time. */
export function encodeRepositoryPath(path: string): string {
  return path.split("/").map(encodeApiResponsePathSegment).join("/");
}

/** True when ref is already a full commit SHA and needs no resolving request. */
export function isCommitSha(ref: string | undefined): ref is string {
  return ref !== undefined && COMMIT_SHA.test(ref);
}

/** A moving branch must not splice two versions of one file into a read. */
export function assertContinuationRef(
  options: RepositoryContentsOptions | undefined,
  sha: string,
): void {
  if ((options?.offset ?? 0) > 0 && options?.ref !== sha) {
    throw new ForgesError("Continue file reads with the resolved SHA from the first slice", 409);
  }
}

/** The 413 for a file too large to read through the API. */
export function fileTooLarge(path: string, size: number): ForgesError {
  return new ForgesError(
    `File ${path} is ${size} bytes; reads stop at ${MAX_FILE_BYTES}. Clone the repository for larger files`,
    413,
  );
}

/** Refuse a file above the decode limit before its bytes are touched. */
export function assertFileSize(path: string, size: number): void {
  if (size > MAX_FILE_BYTES) throw fileTooLarge(path, size);
}

/** Map the GitHub and Gitea contents entry type. */
export function contentsEntryType(type: string): RepositoryEntryType {
  if (type === "dir") return "directory";
  if (type === "symlink" || type === "submodule") return type;
  return "file";
}

/** A path that is neither a file nor a directory has nothing to read. */
export function unreadableEntry(path: string, type: string): ForgesError {
  return new ForgesError(`Repository path ${path} is a ${type}, not a file or directory`, 422);
}

function decodeText(bytes: Uint8Array): string | null {
  if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Which file a platform served: its path and the blob or commit SHA it reported. */
export interface RepositoryFileRef {
  path: string;
  sha: string;
}

/** Decode base64 file content and cut one bounded slice of its text. */
export function buildRepositoryFile(
  file: RepositoryFileRef & { base64: string },
  options: RepositoryContentsOptions = {},
): RepositoryFileContents {
  const { path, sha, base64 } = file;
  const bytes = Buffer.from(base64.replaceAll("\n", ""), "base64");
  return buildRepositoryFileFromBytes({ path, sha, bytes }, options);
}

/** Cut one bounded slice of a file a platform served as raw bytes. */
export function buildRepositoryFileFromBytes(
  file: RepositoryFileRef & { bytes: Uint8Array },
  options: RepositoryContentsOptions = {},
): RepositoryFileContents {
  const { path, sha, bytes } = file;
  const window = assertRepositoryContentsOptions(options);
  assertFileSize(path, bytes.length);
  const text = decodeText(bytes);
  const { end, nextOffset, truncated } = textWindowEnd(window, {
    length: text?.length ?? 0,
    pastEnd: "File offset is past the end of the file",
  });
  return {
    type: "file",
    path,
    sha,
    size: bytes.length,
    binary: text === null,
    content: text === null ? "" : text.slice(window.offset, end),
    offset: window.offset,
    nextOffset,
    truncated,
  };
}

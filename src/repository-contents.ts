import { Buffer } from "node:buffer";
import { ForgesError } from "./errors.ts";
import { encodeApiResponsePathSegment } from "./providers/base-url.ts";
import type {
  RepositoryContentsOptions,
  RepositoryEntryType,
  RepositoryFileContents,
} from "./types.ts";

export const DEFAULT_FILE_MAX_CHARS = 20_000;
export const MAX_FILE_CHARS = 200_000;
/** Largest file a read decodes. GitHub's contents API stops returning content above it. */
export const MAX_FILE_BYTES = 1_048_576;

/** Git's own heuristic: a NUL byte in the first 8000 bytes makes a file binary. */
const BINARY_PROBE_BYTES = 8000;
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** Validate slice bounds before provider I/O. */
export function assertRepositoryContentsOptions(options: RepositoryContentsOptions = {}): void {
  const offset = options.offset ?? 0;
  const maxChars = options.maxChars ?? DEFAULT_FILE_MAX_CHARS;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ForgesError("File offset must be a non-negative integer", 400);
  }
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > MAX_FILE_CHARS) {
    throw new ForgesError(`File maxChars must be an integer from 1 to ${MAX_FILE_CHARS}`, 400);
  }
  if (!Number.isSafeInteger(offset + maxChars)) {
    throw new ForgesError("File range exceeds the safe integer limit", 400);
  }
  if (options.ref !== undefined && options.ref.length === 0) {
    throw new ForgesError("File ref must not be empty", 400);
  }
}

/** Trim outer slashes and refuse segments like `..`; an empty result is the root. */
export function normalizeRepositoryPath(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/gu, "");
  if (trimmed === "") return "";
  try {
    for (const segment of trimmed.split("/")) encodeApiResponsePathSegment(segment);
  } catch {
    throw new ForgesError(`Invalid repository path: ${path}`, 400);
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

/** Decode base64 file content and cut one bounded slice of its text. */
export function buildRepositoryFile(
  path: string,
  sha: string,
  base64: string,
  options: RepositoryContentsOptions = {},
): RepositoryFileContents {
  assertRepositoryContentsOptions(options);
  const bytes = Buffer.from(base64.replaceAll("\n", ""), "base64");
  assertFileSize(path, bytes.length);
  const offset = options.offset ?? 0;
  const text = decodeText(bytes);
  const binary = text === null;
  const length = text?.length ?? 0;
  if (offset > length) {
    throw new ForgesError("File offset is past the end of the file", 400);
  }
  const end = Math.min(offset + (options.maxChars ?? DEFAULT_FILE_MAX_CHARS), length);
  return {
    type: "file",
    path,
    sha,
    size: bytes.length,
    binary,
    content: text === null ? "" : text.slice(offset, end),
    offset,
    nextOffset: end < length ? end : null,
    truncated: end < length,
  };
}

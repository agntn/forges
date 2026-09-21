import { execFile, spawn } from "node:child_process";

export interface VerifyLocalMergeOptions {
  cwd: string;
  head: string;
  mergeCommit: string;
  target: string;
  /** Literal paths relative to the repository root, not Git pathspec patterns. */
  paths: string[];
}

export interface LocalMergeVerification {
  headSha: string;
  mergeSha: string;
  targetSha: string;
  mergeReachable: boolean;
  pathsMatch: boolean;
  paths: string[];
}

/** A failed Git command is not a negative ancestry or comparison result. */
export class LocalGitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalGitError";
  }
}

function gitArgs(args: string[], pathspecs: "literal" | "git"): string[] {
  return [
    "--no-pager",
    "-c",
    "core.fsmonitor=false",
    "--no-replace-objects",
    "--no-lazy-fetch",
    pathspecs === "literal" ? "--literal-pathspecs" : "--no-literal-pathspecs",
    ...args,
  ];
}

function gitOptions(cwd: string) {
  return {
    cwd,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
      ),
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
    },
    timeout: 10_000,
  };
}

function trackedFilesPage(
  cwd: string,
  paths: string[],
  offset: number,
  limit: number,
): Promise<{
  trackedFiles: string[];
  nextFilesOffset: number | null;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      gitArgs(["ls-files", "--cached", "--deduplicate", "-z", "--", ...paths], "git"),
      {
        ...gitOptions(cwd),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const trackedFiles: string[] = [];
    let pending = Buffer.alloc(0);
    let stderr = "";
    let count = 0;
    let bytes = 0;
    let full = false;
    let failure: Error | undefined;
    child.on("error", (error) => {
      failure = error;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(0, 8192);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure) return;
      pending = Buffer.concat([pending, chunk]);
      let end: number;
      while ((end = pending.indexOf(0)) !== -1) {
        const path = pending.subarray(0, end);
        pending = pending.subarray(end + 1);
        if (path.length > 64 * 1024) {
          failure = new LocalGitError("Git ls-files returned a path exceeding 64 KiB");
          child.kill();
          return;
        }
        if (count++ < offset || full) continue;
        if (trackedFiles.length >= limit || bytes + path.length > 64 * 1024) {
          full = true;
          continue;
        }
        trackedFiles.push(path.toString("utf8"));
        bytes += path.length;
      }
      if (pending.length > 64 * 1024) {
        failure = new LocalGitError("Git ls-files returned a path exceeding 64 KiB");
        child.kill();
      }
    });
    child.on("close", (code, signal) => {
      if (failure || code !== 0 || signal || pending.length) {
        reject(
          new LocalGitError(
            `Git ls-files failed: ${failure?.message || stderr.trim() || signal || code || "incomplete path"}`,
            { cause: failure },
          ),
        );
        return;
      }
      resolve({ trackedFiles, nextFilesOffset: full ? offset + trackedFiles.length : null });
    });
  });
}

function git(
  cwd: string,
  args: string[],
  predicate = false,
  pathspecs: "literal" | "git" = "literal",
): Promise<{ output: string; ok: boolean }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      gitArgs(args, pathspecs),
      { ...gitOptions(cwd), encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && !(predicate && error.code === 1 && !error.killed && !error.signal)) {
          reject(
            new LocalGitError(`Git ${args[0]} failed: ${stderr.trim() || error.message}`, {
              cause: error,
            }),
          );
          return;
        }
        resolve({ output: stdout, ok: !error });
      },
    );
  });
}

function assertText(value: string, label: string): void {
  if (typeof value !== "string" || !value.length || value.includes("\0")) {
    throw new TypeError(`${label} must be a nonempty string without NUL bytes`);
  }
}

/** Reads local commits only. Matching selected paths does not prove a branch can be deleted. */
export async function verifyLocalMerge(
  options: VerifyLocalMergeOptions,
): Promise<LocalMergeVerification> {
  const { cwd, head, mergeCommit, target } = options;
  for (const [label, value] of Object.entries({ cwd, head, mergeCommit, target })) {
    assertText(value, label);
  }
  if (!Array.isArray(options.paths) || options.paths.length === 0 || options.paths.length > 100) {
    throw new TypeError("paths must contain between 1 and 100 literal repository paths");
  }
  const paths = [...options.paths];
  for (const path of paths) {
    assertText(path, "path");
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      /^[A-Za-z]:/.test(path) ||
      path.split("/").some((part) => part === ".." || part === "." || part === "")
    ) {
      throw new TypeError("paths must be relative to the repository root without dot segments");
    }
  }
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).output.replace(/\n$/, "");
  const resolveCommit = async (ref: string) =>
    (
      await git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])
    ).output.trim();
  const headSha = await resolveCommit(head);
  const mergeSha = await resolveCommit(mergeCommit);
  const targetSha = await resolveCommit(target);
  const mergeParent = (await git(root, ["rev-list", "--parents", "-n", "1", mergeSha])).output
    .trim()
    .split(" ")
    .slice(1, 2);
  for (const path of paths) {
    let exists = false;
    for (const sha of [headSha, mergeSha, ...mergeParent]) {
      const { output } = await git(root, ["ls-tree", "--name-only", "-z", sha, "--", path]);
      if (output.split("\0").includes(path)) {
        exists = true;
        break;
      }
    }
    if (!exists)
      throw new TypeError("Every selected path must exist in the head, merge or first-parent tree");
  }
  const mergeReachable = (
    await git(root, ["merge-base", "--is-ancestor", mergeSha, targetSha], true)
  ).ok;
  const pathsMatch = (
    await git(
      root,
      [
        "diff",
        "--quiet",
        "--no-ext-diff",
        "--no-textconv",
        "--ignore-submodules=none",
        headSha,
        mergeSha,
        "--",
        ...paths,
      ],
      true,
    )
  ).ok;
  return { headSha, mergeSha, targetSha, mergeReachable, pathsMatch, paths };
}

export interface InspectLocalOptions {
  cwd: string;
  /** Git pathspecs relative to the repository root; omitted means all paths. */
  paths?: string[];
  historyLimit?: number;
  /** Zero-based inventory offset; continue with nextFilesOffset and unchanged pathspecs. */
  filesOffset?: number;
  /** Maximum names per page, 1-1000 (default 1000), also bounded by 64 KiB of path bytes. */
  filesLimit?: number;
}

export interface LocalStatusEntry {
  index: string;
  worktree: string;
  path: string;
  originalPath?: string;
}

export interface LocalInspection {
  root: string;
  headSha: string | null;
  status: LocalStatusEntry[];
  trackedFiles: string[];
  /** Null when this scan reached the end; pages are not an atomic index snapshot. */
  nextFilesOffset: number | null;
  commits: { sha: string; subject: string; body: string }[];
}

function parseStatus(output: string): LocalStatusEntry[] {
  const fields = output.split("\0");
  fields.pop();
  const entries: LocalStatusEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    const entry: LocalStatusEntry = {
      index: field[0]!,
      worktree: field[1]!,
      path: field.slice(3),
    };
    if (
      entry.index === "R" ||
      entry.index === "C" ||
      entry.worktree === "R" ||
      entry.worktree === "C"
    ) {
      entry.originalPath = fields[++i]!;
    }
    entries.push(entry);
  }
  return entries;
}

/** Local reads only; concurrent edits can change the checkout between reads. */
export async function inspectLocal(options: InspectLocalOptions): Promise<LocalInspection> {
  assertText(options.cwd, "cwd");
  if (
    options.paths !== undefined &&
    (!Array.isArray(options.paths) || options.paths.length > 100)
  ) {
    throw new TypeError("paths must contain at most 100 Git pathspecs");
  }
  const paths = [...(options.paths ?? [])];
  for (const path of paths) assertText(path, "pathspec");
  const historyLimit = options.historyLimit ?? 3;
  if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 100) {
    throw new TypeError("historyLimit must be an integer between 1 and 100");
  }
  const filesOffset = options.filesOffset ?? 0;
  const filesLimit = options.filesLimit ?? 1000;
  if (!Number.isSafeInteger(filesOffset) || filesOffset < 0) {
    throw new TypeError("filesOffset must be a nonnegative safe integer");
  }
  if (!Number.isInteger(filesLimit) || filesLimit < 1 || filesLimit > 1000) {
    throw new TypeError("filesLimit must be an integer between 1 and 1000");
  }
  const root = (await git(options.cwd, ["rev-parse", "--show-toplevel"])).output.replace(/\n$/, "");
  const head = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], true);
  if (!head.ok) {
    const branch = (await git(root, ["symbolic-ref", "HEAD"])).output.replace(/\n$/, "");
    if ((await git(root, ["show-ref", "--verify", "--quiet", branch], true)).ok) {
      throw new LocalGitError("HEAD does not resolve to a commit");
    }
  }
  const headSha = head.ok ? head.output.trim() : null;
  const [status, files, history] = await Promise.all([
    git(
      root,
      [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=none",
        "--renames",
        "--",
        ...paths,
      ],
      false,
      "git",
    ),
    trackedFilesPage(root, paths, filesOffset, filesLimit),
    headSha === null
      ? Promise.resolve({ output: "" })
      : git(
          root,
          [
            "log",
            "--no-show-signature",
            "--no-notes",
            "--encoding=UTF-8",
            "-z",
            `--max-count=${historyLimit}`,
            "--format=format:%H%x00%s%x00%b",
            headSha,
            "--",
            ...paths,
          ],
          false,
          "git",
        ),
  ]);
  const fields = history.output.split("\0");
  const commits: LocalInspection["commits"] = [];
  if (history.output) {
    if (fields.length % 3 !== 0) throw new LocalGitError("Malformed Git log output");
    for (let i = 0; i < fields.length; i += 3) {
      commits.push({ sha: fields[i]!, subject: fields[i + 1]!, body: fields[i + 2]! });
    }
  }
  return {
    root,
    headSha,
    status: parseStatus(status.output),
    ...files,
    commits,
  };
}

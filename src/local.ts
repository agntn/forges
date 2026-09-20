import { execFile } from "node:child_process";

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

function git(
  cwd: string,
  args: string[],
  predicate = false,
): Promise<{ output: string; ok: boolean }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["--no-pager", "--no-replace-objects", "--no-lazy-fetch", "--literal-pathspecs", ...args],
      {
        cwd,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
          ),
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
        },
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      },
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

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalGitError, verifyLocalMerge } from "../src/local.ts";

let cwd: string;
function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function commit(text: string): string {
  writeFileSync(join(cwd, "file.txt"), text);
  git("add", "--all");
  git("commit", "-qm", text);
  return git("rev-parse", "HEAD");
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "forges-local-"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", join(cwd, "no-hooks"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(cwd, { recursive: true, force: true });
});

describe("verifyLocalMerge", () => {
  it("preserves a carriage return at the end of the checkout directory", async () => {
    const head = commit("base");
    renameSync(cwd, `${cwd}\r`);
    cwd += "\r";
    expect(
      await verifyLocalMerge({ cwd, head, mergeCommit: head, target: head, paths: ["file.txt"] }),
    ).toMatchObject({ mergeReachable: true, pathsMatch: true });
  });

  it("verifies a deletion shared by the PR head and squash result", async () => {
    commit("base");
    git("switch", "-qc", "topic");
    git("rm", "file.txt");
    git("commit", "-qm", "remove file");
    const head = git("rev-parse", "HEAD");
    git("switch", "-q", "main");
    git("merge", "--squash", "topic");
    git("commit", "-qm", "squash deletion");
    expect(
      await verifyLocalMerge({
        cwd,
        head,
        mergeCommit: "main",
        target: "main",
        paths: ["file.txt"],
      }),
    ).toMatchObject({ mergeReachable: true, pathsMatch: true });
  });

  it("rejects paths absent from both trees rather than returning a vacuous match", async () => {
    const head = commit("base");
    await expect(
      verifyLocalMerge({ cwd, head, mergeCommit: head, target: head, paths: ["typo.txt"] }),
    ).rejects.toThrow("must exist");
  });

  it("checks a large directory without enumerating its descendants", async () => {
    const base = commit("base");
    const blob = git("rev-parse", `${base}:file.txt`);
    const entries = Array.from(
      { length: 9000 },
      (_, i) => `100644 blob ${blob}\t${String(i).padStart(5, "0")}${"x".repeat(120)}\n`,
    ).join("");
    const tree = execFileSync("git", ["mktree"], { cwd, input: entries, encoding: "utf8" }).trim();
    const root = execFileSync("git", ["mktree"], {
      cwd,
      input: `040000 tree ${tree}\tvendor\n`,
      encoding: "utf8",
    }).trim();
    const head = git("commit-tree", root, "-p", base, "-m", "large directory");
    expect(
      await verifyLocalMerge({
        cwd,
        head,
        mergeCommit: head,
        target: head,
        paths: ["vendor", `vendor/00000${"x".repeat(120)}`],
      }),
    ).toMatchObject({ pathsMatch: true, mergeReachable: true });
  });

  it("ignores inherited Git repository selectors", async () => {
    const head = commit("base");
    vi.stubEnv("GIT_DIR", join(cwd, "missing.git"));
    vi.stubEnv("GIT_WORK_TREE", "/missing");
    expect(
      await verifyLocalMerge({ cwd, head, mergeCommit: head, target: head, paths: ["file.txt"] }),
    ).toMatchObject({ mergeReachable: true, pathsMatch: true });
  });

  it("verifies squash content without requiring head ancestry and preserves dirty state", async () => {
    commit("base");
    git("switch", "-qc", "topic");
    const head = commit("feature");
    git("switch", "-q", "main");
    git("merge", "--squash", "topic");
    git("commit", "-qm", "squashed");
    const mergeCommit = git("rev-parse", "HEAD");
    commit("later change");
    writeFileSync(join(cwd, "untracked"), "keep");
    writeFileSync(join(cwd, "file.txt"), "staged");
    git("add", "file.txt");
    const before = git("status", "--porcelain=v1");
    const result = await verifyLocalMerge({
      cwd,
      head,
      mergeCommit,
      target: "main",
      paths: ["file.txt"],
    });
    expect(result).toEqual({
      headSha: head,
      mergeSha: mergeCommit,
      targetSha: git("rev-parse", "main"),
      mergeReachable: true,
      pathsMatch: true,
      paths: ["file.txt"],
    });
    expect(git("status", "--porcelain=v1")).toBe(before);
    expect(git("branch", "--show-current")).toBe("main");
  });

  it("separates differing contents from a merge outside the target history", async () => {
    const base = commit("base");
    const head = commit("feature");
    expect(
      await verifyLocalMerge({
        cwd,
        head: base,
        mergeCommit: head,
        target: base,
        paths: ["file.txt"],
      }),
    ).toMatchObject({ mergeReachable: false, pathsMatch: false });
  });

  it("uses literal root-relative paths even when called in a subdirectory", async () => {
    writeFileSync(join(cwd, "[a].txt"), "same");
    const head = commit("base");
    writeFileSync(join(cwd, "a.txt"), "different");
    const mergeCommit = commit("next");
    mkdirSync(join(cwd, "sub"));
    expect(
      await verifyLocalMerge({
        cwd: join(cwd, "sub"),
        head,
        mergeCommit,
        target: "main",
        paths: ["[a].txt"],
      }),
    ).toMatchObject({ pathsMatch: true });
  });

  it("compares modes and deletions without running external diff drivers", async () => {
    const head = commit("base");
    git("update-index", "--chmod=+x", "file.txt");
    git("commit", "-qm", "executable");
    const modeCommit = git("rev-parse", "HEAD");
    git("config", "diff.external", "forges-command-that-does-not-exist");
    expect(
      await verifyLocalMerge({
        cwd,
        head,
        mergeCommit: modeCommit,
        target: "main",
        paths: ["file.txt"],
      }),
    ).toMatchObject({ pathsMatch: false });
    git("rm", "-f", "file.txt");
    git("commit", "-qm", "deleted");
    expect(
      await verifyLocalMerge({
        cwd,
        head,
        mergeCommit: "HEAD",
        target: "main",
        paths: ["file.txt"],
      }),
    ).toMatchObject({ pathsMatch: false });
  });

  it("reports Git failures rather than treating them as false", async () => {
    const head = commit("base");
    await expect(
      verifyLocalMerge({ cwd, head, mergeCommit: "missing", target: "main", paths: ["file.txt"] }),
    ).rejects.toBeInstanceOf(LocalGitError);
    await expect(
      verifyLocalMerge({
        cwd,
        head: "--help",
        mergeCommit: head,
        target: "main",
        paths: ["file.txt"],
      }),
    ).rejects.toBeInstanceOf(LocalGitError);
  });

  it.each([[], ["../file.txt"], ["/file.txt"], ["file.txt\0"], ["."]])(
    "rejects unsafe or empty path selections: %j",
    async (paths) => {
      await expect(
        verifyLocalMerge({ cwd, head: "HEAD", mergeCommit: "HEAD", target: "main", paths }),
      ).rejects.toBeInstanceOf(TypeError);
    },
  );
});

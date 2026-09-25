import * as childProcess from "node:child_process";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { inspectLocal, LocalGitError, verifyLocalMerge } from "../src/local.ts";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, execFile: vi.fn(original.execFile) };
});

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
  vi.clearAllMocks();
  cwd = mkdtempSync(join(tmpdir(), "forges-local-"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", join(cwd, "no-hooks"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(cwd, { recursive: true, force: true });
});

describe("verifyLocalMerge", () => {
  it.skipIf(process.platform === "win32")(
    "preserves a carriage return at the end of the checkout directory",
    async () => {
      const head = commit("base");
      renameSync(cwd, `${cwd}\r`);
      cwd += "\r";
      expect(
        await verifyLocalMerge({ cwd, head, mergeCommit: head, target: head, paths: ["file.txt"] }),
      ).toMatchObject({ mergeReachable: true, pathsMatch: true });
    },
  );

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

  it("removes Git environment keys regardless of case before spawning", async () => {
    const head = commit("base");
    vi.stubEnv("git_dir", join(cwd, "missing.git"));
    vi.stubEnv("Git_Work_Tree", "/missing");
    const spawn = vi.mocked(childProcess.execFile);
    await verifyLocalMerge({ cwd, head, mergeCommit: head, target: head, paths: ["file.txt"] });
    expect(spawn).toHaveBeenCalled();
    for (const call of spawn.mock.calls) {
      expect(call[2]).toHaveProperty("env.GIT_OPTIONAL_LOCKS", "0");
      expect(call[2]).not.toHaveProperty("env.git_dir");
      expect(call[2]).not.toHaveProperty("env.Git_Work_Tree");
    }
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

describe("inspectLocal", () => {
  it("pages an inventory larger than the subprocess buffer without losing paths", async () => {
    const base = commit("base");
    const blob = git("rev-parse", `${base}:file.txt`);
    const paths = Array.from(
      { length: 9000 },
      (_, i) => `${String(i).padStart(5, "0")}${"x".repeat(120)}`,
    );
    const tree = execFileSync("git", ["mktree"], {
      cwd,
      input: paths.map((path) => `100644 blob ${blob}\t${path}\n`).join(""),
      encoding: "utf8",
    }).trim();
    const head = git("commit-tree", tree, "-p", base, "-m", "large inventory");
    git("update-ref", "HEAD", head);
    git("read-tree", "HEAD");
    execFileSync("git", ["update-index", "--skip-worktree", "--stdin"], {
      cwd,
      input: paths.join("\n") + "\n",
    });
    const recovered: string[] = [];
    let filesOffset = 0;
    do {
      const result = await inspectLocal({ cwd, filesOffset });
      expect(result.status).toEqual([{ index: "?", worktree: "?", path: "file.txt" }]);
      expect(result.commits[0]).toEqual({ sha: head, subject: "large inventory", body: "" });
      expect(result.trackedFiles.length).toBeGreaterThan(0);
      expect(result.trackedFiles.length).toBeLessThanOrEqual(1000);
      expect(Buffer.byteLength(result.trackedFiles.join(""))).toBeLessThanOrEqual(64 * 1024);
      recovered.push(...result.trackedFiles);
      if (result.nextFilesOffset === null) break;
      expect(result.nextFilesOffset).toBeGreaterThan(filesOffset);
      filesOffset = result.nextFilesOffset;
    } while (recovered.length <= paths.length);
    expect(recovered).toEqual(paths);
  });

  it("pages a status larger than the subprocess buffer without losing rows", async () => {
    commit("base");
    const paths = Array.from(
      { length: 9000 },
      (_, i) => `${String(i).padStart(5, "0")}${"y".repeat(120)}`,
    );
    for (const path of paths) writeFileSync(join(cwd, path), "");
    const recovered: string[] = [];
    let statusOffset = 0;
    do {
      const result = await inspectLocal({ cwd, statusOffset, filesLimit: 1 });
      expect(result.trackedFiles).toEqual(["file.txt"]);
      expect(result.status.length).toBeGreaterThan(0);
      expect(result.status.length).toBeLessThanOrEqual(1000);
      expect(Buffer.byteLength(result.status.map((entry) => entry.path).join(""))).toBeLessThan(
        64 * 1024,
      );
      recovered.push(...result.status.map((entry) => entry.path));
      if (result.nextStatusOffset === null) break;
      expect(result.nextStatusOffset).toBeGreaterThan(statusOffset);
      statusOffset = result.nextStatusOffset;
    } while (recovered.length <= paths.length);
    expect(recovered).toEqual(paths);
  });

  it("bounds status rows separately from tracked paths", async () => {
    commit("base");
    for (const name of ["a.txt", "b.txt", "c.txt"]) writeFileSync(join(cwd, name), name);
    expect(await inspectLocal({ cwd, statusLimit: 2 })).toMatchObject({
      status: [
        { index: "?", worktree: "?", path: "a.txt" },
        { index: "?", worktree: "?", path: "b.txt" },
      ],
      nextStatusOffset: 2,
      trackedFiles: ["file.txt"],
      nextFilesOffset: null,
    });
    expect(await inspectLocal({ cwd, statusLimit: 2, statusOffset: 2 })).toMatchObject({
      status: [{ index: "?", worktree: "?", path: "c.txt" }],
      nextStatusOffset: null,
    });
    expect(await inspectLocal({ cwd, statusOffset: 10 })).toMatchObject({
      status: [],
      nextStatusOffset: null,
    });
  });

  it("keeps a rename pair larger than the page budget as its own page", async () => {
    commit("base");
    const spawn = childProcess.spawn;
    const program = [
      'process.stdout.write("R  " + "a".repeat(40000) + "\\0" + "b".repeat(40000) + "\\0")',
      'process.stdout.write("?? c.txt\\0")',
    ].join(";");
    vi.spyOn(childProcess, "spawn").mockImplementation(((
      file: string,
      args: string[],
      options: childProcess.SpawnOptions,
    ) =>
      args.includes("status")
        ? spawn(process.execPath, ["-e", program])
        : spawn(file, args, options)) as typeof childProcess.spawn);
    expect(await inspectLocal({ cwd })).toMatchObject({
      status: [
        { index: "R", worktree: " ", path: "a".repeat(40000), originalPath: "b".repeat(40000) },
      ],
      nextStatusOffset: 1,
    });
    expect(await inspectLocal({ cwd, statusOffset: 1 })).toMatchObject({
      status: [{ index: "?", worktree: "?", path: "c.txt" }],
      nextStatusOffset: null,
    });
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects statusOffset %s",
    async (statusOffset) => {
      await expect(inspectLocal({ cwd, statusOffset })).rejects.toThrow("statusOffset");
    },
  );

  it.each([0, 1001, 1.5, NaN])("rejects statusLimit %s", async (statusLimit) => {
    await expect(inspectLocal({ cwd, statusLimit })).rejects.toThrow("statusLimit");
  });

  it.each([
    ...["ls-files", "status"].flatMap((command) =>
      [
        'process.stdout.write("?? partial\\0"); process.exitCode = 7',
        'process.stdout.write("?? unterminated")',
        'process.stdout.write("x".repeat(65537) + "\\0")',
        'process.stdout.write("x".repeat(65537))',
      ].map((program): [string, string] => [command, program]),
    ),
    ["status", 'process.stdout.write("R  renamed\\0")'],
  ] satisfies [string, string][])(
    "rejects failed or malformed %s streams: %s",
    async (command, program) => {
      commit("base");
      const spawn = childProcess.spawn;
      vi.spyOn(childProcess, "spawn").mockImplementation(((
        file: string,
        args: string[],
        options: childProcess.SpawnOptions,
      ) =>
        args.includes(command)
          ? spawn(process.execPath, ["-e", program])
          : spawn(file, args, options)) as typeof childProcess.spawn);
      await expect(inspectLocal({ cwd })).rejects.toThrow(`Git ${command} failed`);
    },
  );

  it("uses an exact page boundary and allows offsets beyond the inventory", async () => {
    writeFileSync(join(cwd, "a.txt"), "a");
    commit("base");
    expect(await inspectLocal({ cwd, filesLimit: 1 })).toMatchObject({
      trackedFiles: ["a.txt"],
      nextFilesOffset: 1,
    });
    expect(await inspectLocal({ cwd, filesLimit: 1, filesOffset: 1 })).toMatchObject({
      trackedFiles: ["file.txt"],
      nextFilesOffset: null,
    });
    expect(await inspectLocal({ cwd, filesOffset: 10 })).toMatchObject({
      trackedFiles: [],
      nextFilesOffset: null,
    });
    expect(await inspectLocal({ cwd, paths: ["missing"] })).toMatchObject({
      trackedFiles: [],
      nextFilesOffset: null,
    });
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects filesOffset %s",
    async (filesOffset) => {
      await expect(inspectLocal({ cwd, filesOffset })).rejects.toThrow("filesOffset");
    },
  );

  it.each([0, 1001, 1.5, NaN])("rejects filesLimit %s", async (filesLimit) => {
    await expect(inspectLocal({ cwd, filesLimit })).rejects.toThrow("filesLimit");
  });

  it("returns filtered status, tracked paths and full commit messages", async () => {
    mkdirSync(join(cwd, "nested"));
    writeFileSync(join(cwd, "nested/AGENTS.md"), "rules");
    const first = commit("base");
    writeFileSync(join(cwd, "nested/AGENTS.md"), "new rules");
    git("add", "nested/AGENTS.md");
    git("commit", "-qm", "update rules", "-m", "Reason line one.\nReason line two.");
    const second = git("rev-parse", "HEAD");
    writeFileSync(join(cwd, "nested/AGENTS.md"), "staged");
    git("add", "nested/AGENTS.md");
    writeFileSync(join(cwd, "nested/AGENTS.md"), "unstaged");
    writeFileSync(join(cwd, "file.txt"), "unrelated");
    const result = await inspectLocal({ cwd: join(cwd, "nested"), paths: ["*AGENTS.md"] });
    expect(result).toEqual({
      root: cwd,
      headSha: second,
      status: [{ index: "M", worktree: "M", path: "nested/AGENTS.md" }],
      nextStatusOffset: null,
      trackedFiles: ["nested/AGENTS.md"],
      nextFilesOffset: null,
      commits: [
        { sha: second, subject: "update rules", body: "Reason line one.\nReason line two.\n" },
        { sha: first, subject: "base", body: "" },
      ],
    });
    expect((await inspectLocal({ cwd, paths: ["*AGENTS.md"], historyLimit: 1 })).commits).toEqual(
      result.commits.slice(0, 1),
    );
  });

  it.skipIf(process.platform === "win32")(
    "preserves unusual paths and separates rename source from destination",
    async () => {
      const original = "old\nname.txt";
      const destination = "new\tname.txt";
      writeFileSync(join(cwd, original), "rename me");
      commit("base");
      git("mv", "--", original, destination);
      const untracked = "--flag $(not-a-command).txt";
      writeFileSync(join(cwd, untracked), "untracked");
      const result = await inspectLocal({ cwd });
      expect(result.status).toEqual([
        { index: "R", worktree: " ", path: destination, originalPath: original },
        { index: "?", worktree: "?", path: untracked },
      ]);
      expect(result.trackedFiles).toEqual(["file.txt", destination]);
    },
  );

  it("supports literal pathspecs, exclusions and empty matches", async () => {
    writeFileSync(join(cwd, "[a].txt"), "literal");
    writeFileSync(join(cwd, "a.txt"), "pattern");
    commit("base");
    expect((await inspectLocal({ cwd, paths: [":(literal)[a].txt"] })).trackedFiles).toEqual([
      "[a].txt",
    ]);
    expect(
      (await inspectLocal({ cwd, paths: ["*.txt", ":(exclude)file.txt"] })).trackedFiles,
    ).toEqual(["[a].txt", "a.txt"]);
    expect(await inspectLocal({ cwd, paths: ["missing"] })).toMatchObject({
      status: [],
      trackedFiles: [],
      commits: [],
    });
  });

  it("reads an unborn branch without treating it as a command failure", async () => {
    writeFileSync(join(cwd, "staged.txt"), "staged");
    git("add", "staged.txt");
    expect(await inspectLocal({ cwd })).toEqual({
      root: cwd,
      headSha: null,
      status: [{ index: "A", worktree: " ", path: "staged.txt" }],
      nextStatusOffset: null,
      trackedFiles: ["staged.txt"],
      nextFilesOffset: null,
      commits: [],
    });
  });

  it("preserves the index and ignores ambient Git overrides", async () => {
    commit("base");
    writeFileSync(join(cwd, "file.txt"), "dirty");
    const index = readFileSync(join(cwd, ".git/index"));
    vi.stubEnv("GIT_DIR", "/missing");
    const result = await inspectLocal({ cwd });
    expect(result.status).toEqual([{ index: " ", worktree: "M", path: "file.txt" }]);
    expect(readFileSync(join(cwd, ".git/index"))).toEqual(index);
    for (const call of vi.mocked(childProcess.execFile).mock.calls) {
      expect(call[1]).toContain("--no-lazy-fetch");
    }
  });

  it.skipIf(process.platform === "win32")(
    "does not invoke a configured fsmonitor hook",
    async () => {
      commit("base");
      git("config", "core.fsmonitor", "echo invoked > fsmonitor-ran; false");
      await inspectLocal({ cwd });
      expect(existsSync(join(cwd, "fsmonitor-ran"))).toBe(false);
    },
  );

  it("does not mistake a broken detached HEAD for an unborn branch", async () => {
    commit("base");
    writeFileSync(join(cwd, ".git/HEAD"), `${"1".repeat(40)}\n`);
    await expect(inspectLocal({ cwd })).rejects.toBeInstanceOf(LocalGitError);
  });

  it("defaults to three commits and fails instead of truncating oversized output", async () => {
    for (const text of ["one", "two", "three", "four"]) commit(text);
    expect((await inspectLocal({ cwd })).commits.map((entry) => entry.subject)).toEqual([
      "four",
      "three",
      "two",
    ]);
    const message = join(cwd, ".git/message");
    writeFileSync(message, `large\n\n${"x".repeat(1024 * 1024)}`);
    git("commit", "--allow-empty", "-q", "-F", message);
    await expect(inspectLocal({ cwd })).rejects.toBeInstanceOf(LocalGitError);
  });

  it.each([0, 101, 1.5, NaN])("rejects historyLimit %s", async (historyLimit) => {
    await expect(inspectLocal({ cwd, historyLimit })).rejects.toThrow("historyLimit");
  });

  it("rejects invalid paths and reports Git failures instead of empty results", async () => {
    await expect(inspectLocal({ cwd, paths: ["bad\0path"] })).rejects.toThrow("NUL");
    await expect(inspectLocal({ cwd, paths: Array(101).fill("a") })).rejects.toThrow("at most 100");
    await expect(inspectLocal({ cwd: join(cwd, "missing") })).rejects.toBeInstanceOf(LocalGitError);
  });
});

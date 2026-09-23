import { describe, expect, it } from "vite-plus/test";
import {
  assertCiId,
  buildCiJobLog,
  cleanGitLabTrace,
  mapActionsJob,
  MAX_JOB_LOG_INPUT_CHARS,
  readJobLogText,
  type ActionsJob,
} from "../src/ci-job-log.ts";

const ESC = "\u001b";

function step(
  number: number,
  name: string,
  conclusion: string,
  started: string | null,
  completed: string | null,
) {
  return {
    number,
    name,
    status: "completed",
    conclusion,
    started_at: started === null ? null : `2026-09-19T14:27:${started}Z`,
    completed_at: completed === null ? null : `2026-09-19T14:27:${completed}Z`,
  };
}

const rawJob: ActionsJob = {
  id: 105912189006,
  run_id: 35448775016,
  name: "test",
  status: "completed",
  conclusion: "failure",
  started_at: "2026-09-19T14:27:10Z",
  completed_at: "2026-09-19T14:27:16Z",
  html_url: "https://github.com/agntn/forges/actions/runs/35448775016/job/105912189006",
  steps: [
    step(1, "Set up job", "success", "10", "12"),
    step(2, "Run npm ci", "success", "12", "15"),
    step(3, "Test", "failure", "15", "16"),
    step(4, "Post Run actions/setup-node", "skipped", "16", "16"),
    step(5, "Post Run actions/checkout", "success", "16", "16"),
    step(6, "Complete job", "success", "16", "16"),
  ],
};

// The GitHub shape: a BOM, 7-digit fractions, an unstamped annotation line and
// the next step starting inside the second the previous one finished.
const githubLog = [
  "\uFEFF2026-09-19T14:27:10.8076235Z Current runner version: '2.337.0'",
  "2026-09-19T14:27:12.2196055Z ##[group]Run npm ci",
  `2026-09-19T14:27:12.2197342Z ${ESC}[36;1mnpm ci${ESC}[0m`,
  "2026-09-19T14:27:12.2207914Z ##[endgroup]",
  "2026-09-19T14:27:15.9000000Z added 12 packages",
  "2026-09-19T14:27:15.9500000Z ##[group]Run npm test",
  `2026-09-19T14:27:16.0000000Z ${ESC}[31mFAIL${ESC}[39m test/a.test.ts`,
  "2026-09-19T14:27:16.1000000Z ##[error]AssertionError: expected 1",
  "to be 2",
  "2026-09-19T14:27:16.2000000Z ##[error]Process completed with exit code 1.",
  "2026-09-19T14:27:16.3000000Z Post job cleanup.",
  "2026-09-19T14:27:16.4000000Z Cleaning up orphan processes",
  "",
].join("\n");

const expectedStream = [
  "--- step 3 Test: failure",
  "##[group]Run npm test",
  "FAIL test/a.test.ts",
  "##[error]AssertionError: expected 1",
  "to be 2",
  "##[error]Process completed with exit code 1.",
  "--- step 1 Set up job: success",
  "Current runner version: '2.337.0'",
  "--- step 2 Run npm ci: success",
  "##[group]Run npm ci",
  "npm ci",
  "##[endgroup]",
  "added 12 packages",
  "--- step 5 Post Run actions/checkout: success",
  "Post job cleanup.",
  "--- step 6 Complete job: success",
  "Cleaning up orphan processes",
  "",
].join("\n");

function textStream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("mapActionsJob", () => {
  it("normalizes the job and each step", () => {
    const job = mapActionsJob(rawJob);

    expect(job).toMatchObject({
      id: "105912189006",
      runId: "35448775016",
      name: "test",
      status: "completed",
      conclusion: "failure",
    });
    expect(job.steps[2]).toEqual({
      number: 3,
      name: "Test",
      status: "completed",
      conclusion: "failure",
      startedAt: "2026-09-19T14:27:15Z",
      completedAt: "2026-09-19T14:27:16Z",
    });
  });
});

describe("buildCiJobLog", () => {
  const job = mapActionsJob(rawJob);

  it("puts the failing step first and every other step after it in order", () => {
    const log = buildCiJobLog(
      job,
      { text: githubLog, complete: true, timestamped: true },
      { maxChars: 200_000 },
    );

    expect(log.content).toBe(expectedStream);
    expect(log).toMatchObject({
      jobId: "105912189006",
      started: true,
      logComplete: true,
      offset: 0,
      nextOffset: null,
      truncated: false,
      length: expectedStream.length,
    });
  });

  it("pages through the same stream with nextOffset", () => {
    const source = { text: githubLog, complete: true, timestamped: true };
    let offset: number | null = 0;
    let joined = "";
    while (offset !== null) {
      const slice = buildCiJobLog(job, source, { offset, maxChars: 40 });
      expect(slice.content.length).toBeLessThanOrEqual(40);
      joined += slice.content;
      offset = slice.nextOffset;
    }

    expect(joined).toBe(expectedStream);
  });

  it("leaves out steps that never ran", () => {
    const pending = {
      number: 7,
      name: "Deploy",
      status: "queued" as const,
      conclusion: null,
      startedAt: "0001-01-01T00:00:00Z",
      completedAt: "0001-01-01T00:00:00Z",
    };
    const log = buildCiJobLog(
      { ...job, steps: [...job.steps, pending] },
      { text: githubLog, complete: true, timestamped: true },
    );

    expect(log.content).toBe(expectedStream);
  });

  it("keeps a log without steps in its own order", () => {
    const log = buildCiJobLog(
      { ...job, steps: [] },
      { text: githubLog, complete: true, timestamped: true },
    );

    expect(log.content.startsWith("Current runner version: '2.337.0'\n##[group]Run npm ci\n")).toBe(
      true,
    );
    expect(log.content).not.toContain("--- step");
  });

  it("says a job without a log never started", () => {
    const log = buildCiJobLog({ ...job, status: "queued", conclusion: null }, null);

    expect(log).toMatchObject({ started: false, content: "", length: 0, nextOffset: null });
  });

  it("rejects an offset past the end and an out-of-range maxChars", () => {
    const source = { text: githubLog, complete: true, timestamped: true };

    expect(() => buildCiJobLog(job, source, { offset: 100_000 })).toThrow(/past the end/u);
    expect(() => buildCiJobLog(job, source, { maxChars: 0 })).toThrow(/maxChars/u);
    expect(() => buildCiJobLog(job, source, { maxChars: 200_001 })).toThrow(/maxChars/u);
  });
});

describe("assertCiId", () => {
  it("accepts positive integers and rejects anything that could leave the path", () => {
    expect(() => assertCiId("105912189006", "job")).not.toThrow();
    for (const id of ["", "0", "-1", "1.5", "12/logs", "..", "0x10"]) {
      expect(() => assertCiId(id, "job"), id).toThrow(/positive integer/u);
    }
  });
});

describe("cleanGitLabTrace", () => {
  it("drops timestamps, section markers, ANSI and redrawn progress", () => {
    const trace = [
      `2026-09-22T22:19:30.123456Z 00O section_start:1790115570:prepare_executor[collapsed=true]\r${ESC}[0K${ESC}[0K${ESC}[36;1mPreparing the executor${ESC}[0;m`,
      "2026-09-22T22:19:31.000000Z 00O Downloading 10%\rDownloading 100%",
      "2026-09-22T22:20:03.985093Z 00O section_end:1790115603:step_script\r" + `${ESC}[0K`,
      "2026-09-22T22:20:03.986801Z 00O+section_start:1790115603:cleanup_file_variables\r" +
        `${ESC}[0K`,
      `2026-09-22T22:20:03.986808Z 00O+${ESC}[0K${ESC}[36;1mCleaning up project directory${ESC}[0;m`,
      "2026-09-22T22:20:03.990000Z 01E warning: on stderr",
      `2026-09-22T22:20:06.821736Z 00O ${ESC}[31;1mERROR: Job failed: exit code 1${ESC}[0;m`,
      "",
    ].join("\n");

    expect(cleanGitLabTrace(trace)).toBe(
      [
        "Preparing the executor",
        "Downloading 100%",
        "Cleaning up project directory",
        "warning: on stderr",
        "ERROR: Job failed: exit code 1",
      ].join("\n"),
    );
  });

  it("leaves an untimestamped trace line by line", () => {
    expect(cleanGitLabTrace(`$ npm test\r\n${ESC}[31mfailed${ESC}[0m\r\n`)).toBe(
      "$ npm test\nfailed",
    );
  });
});

describe("readJobLogText", () => {
  it("decodes a multi-byte character split across chunks", async () => {
    const bytes = new TextEncoder().encode("✓ ok\n");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1));
        controller.enqueue(bytes.slice(1));
        controller.close();
      },
    });

    await expect(readJobLogText(stream)).resolves.toEqual({ text: "✓ ok\n", complete: true });
  });

  it("keeps the end of a log longer than the input limit from a whole line", async () => {
    const line = `${"x".repeat(99)}\n`;
    const head = line.repeat(MAX_JOB_LOG_INPUT_CHARS / line.length);
    const { text, complete } = await readJobLogText(textStream("cut me\n", head, "the failure\n"));

    expect(complete).toBe(false);
    expect(text.length).toBeLessThanOrEqual(MAX_JOB_LOG_INPUT_CHARS);
    expect(text.startsWith(line)).toBe(true);
    expect(text.endsWith("the failure\n")).toBe(true);
    expect(text).not.toContain("cut me");
  });
});

import { stripVTControlCharacters } from "node:util";
import { normalizeCiRunState } from "./ci-run.ts";
import { ForgesError } from "./errors.ts";
import { readTextWindow, textWindowEnd, type TextWindow } from "./text-window.ts";
import type { CiJob, CiJobLog, CiJobLogOptions, CiJobStep, CiRunConclusion } from "./types.ts";

/** The most of one downloaded log a read keeps; a longer log keeps its end. */
export const MAX_JOB_LOG_INPUT_CHARS = 8_000_000;

const failingConclusions = new Set<CiRunConclusion>([
  "failure",
  "timed_out",
  "cancelled",
  "startup_failure",
]);

/** GitHub Actions and Gitea prefix every log line with its UTC time. */
const TIMESTAMP_PREFIX = /^\uFEFF?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z /u;
/** GitLab runners with timestamps add a stream id and a flag: `+` continues the previous line. */
const GITLAB_LINE_PREFIX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z [0-9a-f]{2}[OE]([+ ]?)/u;
/** The erase-line escape after each marker goes with the other ANSI escapes. */
const GITLAB_SECTION_MARKER = /section_(?:start|end):\d+:[\w.-]+(?:\[[^\]\r\n]*\])?\r?/gu;
/** Lines the GitHub runner prints first in a step: a `Run` group or the post-step preamble. */
const STEP_START = /^(?:##\[group\]Run |Post job cleanup\.$|Cleaning up orphan processes$)/u;

/** A workflow job as GitHub Actions and Gitea Actions both return it. */
export interface ActionsJob {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
  steps?: {
    number: number;
    name: string;
    status: string;
    conclusion: string | null;
    started_at?: string | null;
    completed_at?: string | null;
  }[];
}

/** Map the job shape GitHub and Gitea share. */
export function mapActionsJob(raw: ActionsJob): CiJob {
  return {
    id: String(raw.id),
    runId: String(raw.run_id),
    name: raw.name,
    ...normalizeCiRunState(raw.status, raw.conclusion),
    startedAt: raw.started_at ?? null,
    completedAt: raw.completed_at ?? null,
    url: raw.html_url,
    steps: (raw.steps ?? []).map((step) => ({
      number: step.number,
      name: step.name,
      ...normalizeCiRunState(step.status, step.conclusion),
      startedAt: step.started_at ?? null,
      completedAt: step.completed_at ?? null,
    })),
  };
}

/** Validate job ids before provider I/O; every platform numbers its runs and jobs. */
export function assertCiId(id: string, kind: "run" | "job", platform?: string): void {
  if (!/^[1-9]\d*$/u.test(id)) {
    throw new ForgesError(`CI ${kind} id must be a positive integer`, 400, platform);
  }
}

/** Validate log continuation and output bounds before provider I/O. */
export function assertCiJobLogOptions(
  options: CiJobLogOptions = {},
  platform?: string,
): TextWindow {
  return readTextWindow("Job log", options, platform);
}

/** A job that no runner picked up has no log to read. */
export function jobStarted(job: CiJob, reportsSteps: boolean): boolean {
  if (job.status === "queued" || job.status === "waiting") return false;
  if (job.startedAt === null) return false;
  return !reportsSteps || job.steps.length > 0;
}

/** How much of a log's start a read keeps, enough for the header a runner prints first. */
const JOB_LOG_HEAD_CHARS = 4096;

function leadingText(chunks: readonly string[]): string {
  let head = "";
  for (const chunk of chunks) {
    head += chunk.slice(0, JOB_LOG_HEAD_CHARS - head.length);
    if (head.length >= JOB_LOG_HEAD_CHARS) break;
  }
  return head;
}

/** Read a log stream; past {@link MAX_JOB_LOG_INPUT_CHARS} it keeps the end and the header. */
export async function readJobLogText(
  stream: ReadableStream<Uint8Array>,
): Promise<{ text: string; complete: boolean; head: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let length = 0;
  let complete = true;
  let head: string | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (chunk.length > 0) {
        chunks.push(chunk);
        length += chunk.length;
        while (length - chunks[0]!.length >= MAX_JOB_LOG_INPUT_CHARS) {
          head ??= leadingText(chunks);
          length -= chunks.shift()!.length;
          complete = false;
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  let text = chunks.join("");
  head ??= leadingText([text]);
  if (text.length > MAX_JOB_LOG_INPUT_CHARS) {
    text = text.slice(text.length - MAX_JOB_LOG_INPUT_CHARS);
    complete = false;
  }
  if (!complete) {
    // The cut lands mid-line; drop the partial line rather than misread its prefix.
    const newline = text.indexOf("\n");
    text = newline === -1 ? "" : text.slice(newline + 1);
  }
  return { text, complete, head };
}

function plain(text: string): string {
  return stripVTControlCharacters(text);
}

interface LogRecord {
  /** Whole seconds since the epoch, or null for a line the runner did not stamp. */
  second: number | null;
  text: string;
}

function timestampedRecords(log: string): LogRecord[] {
  const records: LogRecord[] = [];
  for (const line of log.replace(/\r?\n$/u, "").split(/\r?\n/u)) {
    const match = TIMESTAMP_PREFIX.exec(line);
    if (match) {
      records.push({
        second: Date.parse(`${match[1]}Z`) / 1000,
        text: plain(line.slice(match[0].length)),
      });
    } else if (records.length > 0) {
      // A multi-line annotation carries its stamp on the first line only.
      records[records.length - 1]!.text += `\n${plain(line)}`;
    } else {
      records.push({ second: null, text: plain(line.replace(/^\uFEFF/u, "")) });
    }
  }
  return records;
}

function stepSecond(value: string | null): number | null {
  if (value === null) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

/**
 * Split a timestamped job log into the steps that ran.
 *
 * Step times are whole seconds, so a step starts at the first record of its
 * second window that opens a step, and at the first record of that window
 * when none does. Every record lands in exactly one step.
 */
function splitBySteps(records: readonly LogRecord[], steps: readonly CiJobStep[]) {
  const ran = steps
    .filter(
      (step) =>
        step.status !== "queued" &&
        step.status !== "waiting" &&
        step.conclusion !== "skipped" &&
        step.startedAt !== null,
    )
    .toSorted((left, right) => left.number - right.number);
  if (ran.length === 0) return null;

  const starts = [0];
  // The first record the next step may claim; an empty step claims none.
  let low = 1;
  for (let index = 1; index < ran.length; index += 1) {
    const step = ran[index]!;
    const from = stepSecond(step.startedAt)!;
    const to = stepSecond(step.completedAt) ?? Number.POSITIVE_INFINITY;
    let first = -1;
    let marked = -1;
    let past = records.length;
    for (let position = low; position < records.length; position += 1) {
      const second = records[position]!.second;
      if (second === null || second < from) continue;
      if (second > to) {
        past = position;
        break;
      }
      if (first === -1) first = position;
      if (STEP_START.test(records[position]!.text)) {
        marked = position;
        break;
      }
    }
    const start = marked !== -1 ? marked : first;
    if (start === -1) {
      starts.push(past);
      low = past;
    } else {
      starts.push(start);
      low = start + 1;
    }
  }
  return ran.map((step, index) => ({
    step,
    lines: records.slice(starts[index], starts[index + 1] ?? records.length).map((r) => r.text),
  }));
}

/** Clean a GitLab trace: timestamp prefixes, collapsible-section markers, ANSI and overwritten progress. */
export function cleanGitLabTrace(trace: string): string {
  const lines: string[] = [];
  for (const line of trace.replace(/\r?\n$/u, "").split("\n")) {
    const match = GITLAB_LINE_PREFIX.exec(line);
    const text = match ? line.slice(match[0].length) : line;
    if (match?.[1] === "+" && lines.length > 0) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  return lines
    .map((line) => {
      const bare = line.replace(GITLAB_SECTION_MARKER, "").replace(/\r$/u, "");
      // A carriage return redraws the line; the terminal shows what came last.
      return plain(bare.slice(bare.lastIndexOf("\r") + 1));
    })
    .join("\n");
}

function stepHeader(step: CiJobStep): string {
  return `--- step ${step.number} ${step.name}: ${step.conclusion ?? step.status}\n`;
}

/**
 * Render a job log into one stable, bounded continuation stream.
 *
 * With steps, each step becomes a headed section and the failing steps come
 * first, so the first slice holds the output that explains the failure.
 */
export function buildCiJobLog(
  job: CiJob,
  log: { text: string; complete: boolean; timestamped: boolean } | null,
  options: CiJobLogOptions = {},
): CiJobLog {
  const window = assertCiJobLogOptions(options);

  let stream = "";
  if (log !== null && log.timestamped) {
    const records = timestampedRecords(log.text);
    const stamped = records.some((record) => record.second !== null);
    const sections = stamped ? splitBySteps(records, job.steps) : null;
    if (sections === null) {
      stream = records.map((record) => `${record.text}\n`).join("");
    } else {
      const ordered = [
        ...sections.filter(({ step }) => failingConclusions.has(step.conclusion)),
        ...sections.filter(({ step }) => !failingConclusions.has(step.conclusion)),
      ];
      stream = ordered
        .map(({ step, lines }) => stepHeader(step) + lines.map((line) => `${line}\n`).join(""))
        .join("");
    }
  } else if (log !== null) {
    stream = log.text.length === 0 || log.text.endsWith("\n") ? log.text : `${log.text}\n`;
  }
  const { end, nextOffset, truncated } = textWindowEnd(
    stream.length,
    window,
    "Job log offset is past the end of the log",
  );
  return {
    jobId: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    started: log !== null,
    logComplete: log?.complete ?? true,
    content: stream.slice(window.offset, end),
    offset: window.offset,
    nextOffset,
    truncated,
    length: stream.length,
  };
}

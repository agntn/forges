import { stripVTControlCharacters } from "node:util";

export interface StatusTheme {
  fg?(color: string, text: string): string;
  bold?(text: string): string;
}

export interface RenderOptions {
  expanded?: boolean;
  isPartial?: boolean;
  spinnerFrame?: number;
  executionStarted?: boolean;
}

export interface RenderedToolResult {
  content?: ReadonlyArray<unknown>;
  details?: unknown;
  isError?: boolean;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SUBJECT_WIDTH = 72;
const META_WIDTH = 40;
const META_LIMIT = 4;
const PREVIEW_LINES = 10;
const PREVIEW_WIDTH = 200;
const FIELD_SCAN_LIMIT = 2048;
const TERMINAL_UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const MALFORMED_SURROGATE = /\p{Cs}/gu;

const WRITE_TOOLS = new Set([
  "forges_issues_create",
  "forges_pull_requests_create",
  "forges_auth_reload",
  "forges_threads_reply",
  "forges_threads_resolve",
  "forges_threads_unresolve",
]);

function cutAt(text: string, end: number): string {
  const last = text.codePointAt(end - 1);
  const splitsPair = last !== undefined && (last > 0xffff || (last >= 0xd800 && last <= 0xdbff));
  return text.slice(0, splitsPair ? end - 1 : end);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${cutAt(text, max - 1)}…`;
}

function cleanTerminalText(text: string): string {
  return stripVTControlCharacters(text.replace(MALFORMED_SURROGATE, " "))
    .replace(TERMINAL_UNSAFE, " ")
    .replaceAll(/\p{Zs}+/gu, " ");
}

/** Sanitize one untrusted value for a compact terminal field. */
export function sanitizeTerminalText(value: unknown, max = SUBJECT_WIDTH): string {
  const text = String(value);
  const bounded = text.length > FIELD_SCAN_LIMIT ? `${cutAt(text, FIELD_SCAN_LIMIT - 1)}…` : text;
  return clip(cleanTerminalText(bounded).replaceAll(/\s+/g, " ").trim(), max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function scalar(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function paint(theme: StatusTheme, color: string, text: string): string {
  return theme.fg ? theme.fg(color, text) : text;
}

/** Stable category mark used by Pi, OMP, and MCP clients. */
export function forgeToolSymbol(name: string): string {
  if (name.startsWith("forges_contribution_templates_")) return "▤";
  if (name.startsWith("forges_pull_requests_")) return "↗";
  if (name.startsWith("forges_threads_")) return "◌";
  if (name.startsWith("forges_commits_")) return "●";
  if (name.startsWith("forges_issues_")) return "◈";
  if (name.startsWith("forges_users_")) return "♙";
  if (name.startsWith("forges_code_")) return "⌕";
  if (name.startsWith("forges_ci_")) return "⚙";
  if (name.startsWith("forges_auth_")) return "⌁";
  return "◆";
}

/** Human-facing title shared with MCP tool menus. */
export function forgeToolTitle(name: string, label: string): string {
  return `${forgeToolSymbol(name)} ${label}`;
}

function repositoryTarget(record: Readonly<Record<string, unknown>>): string | undefined {
  const owner = scalar(record, "owner");
  const repo = scalar(record, "repo");
  if (!owner) return undefined;
  if (!repo) return owner;
  const number = scalar(record, "number");
  return number ? `${owner}/${repo}#${number}` : `${owner}/${repo}`;
}

function callSubject(record: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of ["query", "title", "username", "sha", "key", "threadId", "commentId"]) {
    const value = scalar(record, key);
    if (value) return sanitizeTerminalText(value);
  }
  const target = repositoryTarget(record);
  return target ? sanitizeTerminalText(target) : undefined;
}

function callMeta(
  record: Readonly<Record<string, unknown>>,
  subject: string | undefined,
): string[] {
  const meta: string[] = [];
  const target = repositoryTarget(record);
  if (target && sanitizeTerminalText(target) !== subject) meta.push(sanitizeTerminalText(target));

  const source = scalar(record, "sourceBranch");
  const targetBranch = scalar(record, "targetBranch");
  if (source && targetBranch) {
    meta.push(
      `${sanitizeTerminalText(source, META_WIDTH)} → ${sanitizeTerminalText(targetBranch, META_WIDTH)}`,
    );
  }

  for (const key of ["platform", "kind", "state", "branch", "ref", "page", "perPage"]) {
    const value = scalar(record, key);
    if (value) meta.push(`${key} ${sanitizeTerminalText(value, META_WIDTH)}`);
  }
  if (record.draft === true) meta.push("draft");
  return meta.slice(0, META_LIMIT);
}

function callIcon(options: RenderOptions | undefined): { glyph: string; color: string } {
  if (options?.isPartial === false) return { glyph: "✓", color: "success" };
  if (options?.spinnerFrame !== undefined) {
    return {
      glyph: SPINNER_FRAMES[options.spinnerFrame % SPINNER_FRAMES.length] ?? "⠋",
      color: "accent",
    };
  }
  return options?.executionStarted === true
    ? { glyph: "◌", color: "accent" }
    : { glyph: "·", color: "muted" };
}

/** Render one compact, terminal-safe tool call row. */
export function renderToolCall(
  name: string,
  label: string,
  args: unknown,
  options: RenderOptions | undefined,
  theme: StatusTheme,
): string {
  const record = isRecord(args) ? args : {};
  const icon = callIcon(options);
  const title = forgeToolTitle(name, sanitizeTerminalText(label));
  const parts = [
    paint(theme, icon.color, icon.glyph),
    paint(theme, "toolTitle", theme.bold ? theme.bold(title) : title),
  ];
  const subject = callSubject(record);
  if (subject) parts.push(paint(theme, "dim", subject));
  if (WRITE_TOOLS.has(name)) parts.push(paint(theme, "accent", "(write)"));
  const meta = callMeta(record, subject);
  if (meta.length > 0) parts.push(paint(theme, "muted", meta.join(" · ")));
  return parts.join(" ");
}

function resultText(result: RenderedToolResult): string {
  const parts: string[] = [];
  for (const part of result.content ?? []) {
    if (isRecord(part) && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("\n").trimEnd();
}

function resultPayload(details: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(details) || !isRecord(details.result)) return {};
  return details.result;
}

function resultIdentity(payload: Readonly<Record<string, unknown>>): string | undefined {
  const number = scalar(payload, "number");
  if (number) return `#${sanitizeTerminalText(number, META_WIDTH)}`;
  for (const key of ["fullName", "login", "path", "sourcePath", "name", "sha", "id"]) {
    const value = scalar(payload, key);
    if (value) return sanitizeTerminalText(value, META_WIDTH);
  }
  return undefined;
}

function resultMeta(details: unknown): string[] {
  if (!isRecord(details)) return [];
  const payload = resultPayload(details);
  const meta: string[] = [];
  const identity = resultIdentity(payload);
  if (identity) meta.push(identity);

  if (Array.isArray(payload.items)) meta.push(`${payload.items.length} items`);
  for (const [key, label] of [
    ["files", "files"],
    ["comments", "comments"],
    ["assignees", "assignees"],
  ] as const) {
    const value = payload[key];
    if (Array.isArray(value)) meta.push(`${value.length} ${label}`);
  }

  const state = scalar(payload, "state");
  if (state) meta.push(sanitizeTerminalText(state, META_WIDTH));
  if (payload.merged === true) meta.push("merged");
  else if (payload.draft === true) meta.push("draft");
  if (payload.incomplete === true) meta.push("partial");
  if (payload.hasNextPage === true) {
    const nextPage = scalar(payload, "nextPage");
    meta.push(nextPage ? `next page ${sanitizeTerminalText(nextPage)}` : "more pages");
  }

  const platform = scalar(details, "platform");
  if (platform && meta.length === 0) meta.push(sanitizeTerminalText(platform, META_WIDTH));
  return meta.slice(0, META_LIMIT);
}

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

function cleanBodyLine(text: string): string {
  return cleanTerminalText(text).trimEnd();
}

function expandedBody(result: RenderedToolResult, theme: StatusTheme): string[] {
  const body = resultText(result);
  if (!body) return [];
  return body.split(/\r?\n/u).map((line) => `  ${paint(theme, "toolOutput", cleanBodyLine(line))}`);
}

function failureBody(result: RenderedToolResult, expanded: boolean, theme: StatusTheme): string[] {
  const body = resultText(result);
  if (!body) return [];
  const lines = body.split(/\r?\n/u);
  if (sanitizeTerminalText(lines[0], FIELD_SCAN_LIMIT).length <= SUBJECT_WIDTH) lines.shift();
  return (expanded ? lines : lines.slice(0, PREVIEW_LINES)).map((line) => {
    const clean = cleanBodyLine(line);
    return `  ${paint(theme, "toolOutput", expanded ? clean : clip(clean, PREVIEW_WIDTH))}`;
  });
}

/** Render a compact result row and reveal raw text only when expanded. */
export function renderToolResult(
  name: string,
  result: RenderedToolResult,
  isError: boolean,
  options: RenderOptions,
  theme: StatusTheme,
): string {
  const failed = isError || result.isError === true;
  if (failed) {
    const description = sanitizeTerminalText(firstLine(resultText(result)) || "Failed");
    const header = [
      paint(theme, "error", "✗"),
      paint(theme, "dim", description),
      paint(theme, "accent", "(failed)"),
    ].join(" ");
    const body = failureBody(result, options.expanded === true, theme);
    return body.length > 0 ? [header, ...body].join("\n") : header;
  }

  if (options.isPartial === true) {
    const icon = callIcon(options);
    const description = sanitizeTerminalText(firstLine(resultText(result)) || "Working");
    return `${paint(theme, icon.color, icon.glyph)} ${paint(theme, "dim", description)}`;
  }

  const meta = resultMeta(result.details);
  const header = [
    paint(theme, "success", "✓"),
    paint(theme, "accent", WRITE_TOOLS.has(name) ? "(write)" : "(read)"),
    meta.length > 0 ? paint(theme, "muted", meta.join(" · ")) : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
  const body = options.expanded === true ? expandedBody(result, theme) : [];
  return body.length > 0 ? [header, ...body].join("\n") : header;
}

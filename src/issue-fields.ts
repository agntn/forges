import { ForgesError } from "./errors.ts";
import type { IssueField, IssueFieldValue, IssueType, UpdateIssueInput } from "./types.ts";

type IssueMetadata = Pick<UpdateIssueInput, "type" | "clearType" | "fields" | "clearFields">;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNSAFE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/** A caller's name as a JSON string, with the controls and bidi marks JSON keeps written out. */
export function quoted(text: string): string {
  return JSON.stringify(text).replace(UNSAFE, (char) => {
    const hex = (char.codePointAt(0) ?? 0).toString(16);
    return hex.length > 4 ? `\\u{${hex}}` : `\\u${hex.padStart(4, "0")}`;
  });
}

function refuse(message: string, platform: string | undefined): ForgesError {
  return new ForgesError(message, { status: 400, platform });
}

function isFieldValue(value: unknown): value is IssueFieldValue {
  if (typeof value === "string") return value !== "";
  if (typeof value === "number") return Number.isFinite(value);
  return (
    Array.isArray(value) && value.every((option) => typeof option === "string" && option !== "")
  );
}

function assertFieldMap(fields: unknown, platform: string | undefined): void {
  if (fields === undefined) return;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    throw refuse("fields must map field names to values", platform);
  }
  for (const [name, value] of Object.entries(fields)) {
    if (name.trim() === "" || !isFieldValue(value)) {
      throw refuse(
        `Field ${quoted(name)} needs a non-empty string, a number or a list of option names`,
        platform,
      );
    }
  }
}

function assertNames(names: unknown, platform: string | undefined): void {
  if (names === undefined) return;
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string" || name === "")) {
    throw refuse("clearFields must be an array of field names", platform);
  }
}

/** Whether a create or update names an issue type or field at all. */
export function hasIssueMetadata(input: IssueMetadata): boolean {
  return (
    input.type !== undefined ||
    input.clearType === true ||
    Object.keys(input.fields ?? {}).length > 0 ||
    (input.clearFields?.length ?? 0) > 0
  );
}

/** Rejects a type or field input no forge could take, before anything is written. */
export function assertIssueMetadata(input: IssueMetadata, platform?: string): void {
  if (input.type !== undefined && (typeof input.type !== "string" || input.type.trim() === "")) {
    throw refuse("Issue type must be a non-empty name", platform);
  }
  if (input.clearType !== undefined && typeof input.clearType !== "boolean") {
    throw refuse("clearType must be a boolean", platform);
  }
  if (input.type !== undefined && input.clearType === true) {
    throw refuse("Cannot both set and clear the issue type", platform);
  }
  assertFieldMap(input.fields, platform);
  assertNames(input.clearFields, platform);
  const set = new Set(Object.keys(input.fields ?? {}).map((name) => name.toLowerCase()));
  const both = (input.clearFields ?? []).filter((name) => set.has(name.toLowerCase()));
  if (both.length > 0) {
    const names = both.map(quoted).join(", ");
    throw refuse(`Cannot both set and clear: ${names}`, platform);
  }
}

/** A pull request carries no issue type or fields, so a JavaScript caller passing them is told. */
export function assertNoIssueMetadata(input: object, platform?: string): void {
  const given: Partial<Record<string, unknown>> = input;
  const named = ["type", "clearType", "fields", "clearFields"].filter(
    (key) => given[key] !== undefined,
  );
  if (named.length > 0) {
    throw refuse(`Pull requests take no ${named.join(", ")}`, platform);
  }
}

/** Names match whatever the case, the way the forge's own pickers do. */
function byName<T extends { name: string }>(entries: readonly T[], name: string): T | undefined {
  const wanted = name.toLowerCase();
  return entries.find((entry) => entry.name.toLowerCase() === wanted);
}

function known(entries: ReadonlyArray<{ name: string }>): string {
  return entries.length === 0 ? "none" : entries.map(({ name }) => name).join(", ");
}

/** The type as the repository spells it, or a refusal that lists the ones it has. */
export function matchIssueType(
  types: readonly IssueType[],
  about: Readonly<{ name: string; platform?: string }>,
): string {
  const type = byName(types, about.name);
  if (type === undefined) {
    throw new ForgesError(`No issue type ${quoted(about.name)} here. Types: ${known(types)}`, {
      status: 422,
      platform: about.platform,
    });
  }
  return type.name;
}

/** The field a name points at, or a refusal that lists the ones the repository has. */
export function matchIssueField<T extends IssueField>(
  fields: readonly T[],
  about: Readonly<{ name: string; platform?: string }>,
): T {
  const field = byName(fields, about.name);
  if (field === undefined) {
    throw new ForgesError(`No issue field ${quoted(about.name)} here. Fields: ${known(fields)}`, {
      status: 422,
      platform: about.platform,
    });
  }
  return field;
}

function option(field: IssueField, name: string, platform: string | undefined): string {
  const match = field.options.find((entry) => entry.toLowerCase() === name.toLowerCase());
  if (match === undefined) {
    throw new ForgesError(
      `${field.name} has no option ${quoted(name)}. Options: ${field.options.join(", ")}`,
      { status: 422, platform },
    );
  }
  return match;
}

/** A field's value: a number, a real date, or option names as the field spells them. */
export function issueFieldValue(
  field: IssueField,
  about: Readonly<{ value: IssueFieldValue; platform?: string }>,
): IssueFieldValue {
  const { value, platform } = about;
  const wrong = (expected: string) =>
    new ForgesError(`${field.name} takes ${expected}`, { status: 422, platform });
  switch (field.kind) {
    case "number":
      if (typeof value !== "number") throw wrong("a number");
      return value;
    case "date":
      if (typeof value !== "string" || !isCalendarDate(value)) {
        throw wrong("a date as YYYY-MM-DD");
      }
      return value;
    case "singleSelect":
      if (typeof value !== "string") throw wrong("one option name");
      return option(field, value, platform);
    case "multiSelect":
      return (typeof value === "string" ? [value] : assertList(value, wrong)).map((entry) =>
        option(field, entry, platform),
      );
    case "text":
      if (typeof value !== "string") throw wrong("text");
      return value;
  }
}

function assertList(value: IssueFieldValue, wrong: (expected: string) => Error): string[] {
  if (!Array.isArray(value)) throw wrong("a list of option names");
  return value;
}

/** `2026-02-30` matches the pattern but names no day, and the forge would refuse it late. */
function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

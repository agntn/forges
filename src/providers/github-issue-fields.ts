/** GitHub issue types and organization issue fields: payloads, normal form, and write bodies. */

import { issueFieldValue, matchIssueField } from "../issue-fields.ts";
import type { IssueField, IssueFieldKind, IssueFieldValue, IssueType } from "../types.ts";

export interface GitHubIssueType {
  name: string;
  description: string | null;
  is_enabled?: boolean;
}

export interface GitHubIssueField {
  id: number;
  name: string;
  description: string | null;
  data_type: string;
  options?: Array<{ name: string; priority?: number | null }> | null;
}

export interface GitHubIssueFieldValue {
  issue_field_name?: string;
  data_type?: string;
  value: string | number | null;
  single_select_option?: { name: string } | null;
  multi_select_options?: Array<{ name: string }> | null;
}

/** The type as get and list send it, or the bare name search sends. */
export type GitHubIssueTypeValue = { name: string } | string | null;

/** A field the forge knows by id, which every write needs. */
export interface ResolvedIssueField extends IssueField {
  id: number;
}

const KINDS: Readonly<Record<string, IssueFieldKind>> = {
  text: "text",
  number: "number",
  date: "date",
  single_select: "singleSelect",
  multi_select: "multiSelect",
};

/** Disabled types can't be set, so they stay off the list. */
export function mapIssueTypes(raw: readonly GitHubIssueType[]): IssueType[] {
  return raw
    .filter((type) => type.is_enabled !== false)
    .map((type) => ({ name: type.name, description: type.description ?? "" }));
}

/** Options in the order GitHub's picker shows; a kind forges doesn't know is left out. */
export function mapIssueFields(raw: readonly GitHubIssueField[]): ResolvedIssueField[] {
  return raw.flatMap((field) => {
    const kind = KINDS[field.data_type];
    if (kind === undefined) return [];
    return [
      {
        id: field.id,
        name: field.name,
        kind,
        description: field.description ?? "",
        options: (field.options ?? [])
          .toSorted((left, right) => (left.priority ?? 0) - (right.priority ?? 0))
          .map((option) => option.name),
      },
    ];
  });
}

export function issueTypeName(raw: GitHubIssueTypeValue | undefined): string | null | undefined {
  if (raw === undefined || raw === null) return raw;
  return typeof raw === "string" ? raw : raw.name;
}

function fieldValue(raw: GitHubIssueFieldValue): IssueFieldValue | undefined {
  if (raw.data_type === "single_select" && raw.single_select_option) {
    return raw.single_select_option.name;
  }
  if (raw.data_type === "multi_select") {
    return (
      raw.multi_select_options?.map((option) => option.name) ??
      (typeof raw.value === "string" ? raw.value.split(",") : undefined)
    );
  }
  return raw.value ?? undefined;
}

/** Field name to value; a pull request, which carries none, sends null. */
export function issueFieldValues(
  raw: readonly GitHubIssueFieldValue[] | null | undefined,
): Record<string, IssueFieldValue> | undefined {
  if (raw === undefined || raw === null) return undefined;
  const fields: Record<string, IssueFieldValue> = {};
  for (const entry of raw) {
    const value = fieldValue(entry);
    if (entry.issue_field_name !== undefined && value !== undefined) {
      fields[entry.issue_field_name] = value;
    }
  }
  return fields;
}

/** The body entries for the fields a write sets, every name and value checked first. */
export function fieldWrites(
  definitions: readonly ResolvedIssueField[],
  fields: Readonly<Record<string, IssueFieldValue>>,
): Array<{ field_id: number; value: IssueFieldValue }> {
  return Object.entries(fields).map(([name, value]) => {
    const field = matchIssueField(definitions, { name, platform: "github" });
    return {
      field_id: field.id,
      value: issueFieldValue(field, { value, platform: "github" }),
    };
  });
}

/** The ids of the fields an update empties. */
export function fieldClears(
  definitions: readonly ResolvedIssueField[],
  names: readonly string[],
): number[] {
  return names.map((name) => matchIssueField(definitions, { name, platform: "github" }).id);
}

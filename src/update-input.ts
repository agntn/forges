import { assertAssignees } from "./assignees.ts";
import { ForgesError } from "./errors.ts";
import type { MergePullRequestInput, UpdateIssueInput } from "./types.ts";

const MAX_LABELS = 100;

/** The input field a refusal names, and the platform it came from. */
interface Field {
  field: string;
  platform?: string;
}

function assertLabels(labels: unknown, about: Field): void {
  const { field, platform } = about;
  if (labels === undefined) return;
  if (
    !Array.isArray(labels) ||
    labels.length > MAX_LABELS ||
    labels.some((name) => typeof name !== "string" || name.length === 0)
  ) {
    throw new ForgesError(
      `${field} must be an array of at most ${MAX_LABELS} non-empty names`,
      400,
      platform,
    );
  }
}

function overlap(
  change: Readonly<{
    added: readonly string[] | undefined;
    removed: readonly string[] | undefined;
  }>,
  key: (value: string) => string,
): string[] {
  const { added, removed } = change;
  if (!added?.length || !removed?.length) return [];
  const removedKeys = new Set(removed.map(key));
  return added.filter((value) => removedKeys.has(key(value)));
}

/**
 * Rejects an update that would change nothing or asks for two opposite things,
 * before any request goes out. Logins compare case-insensitively, as every
 * platform treats them; label names compare exactly.
 */
function assertUpdate(
  input: UpdateIssueInput,
  about: Readonly<{ subject: string; platform?: string }>,
): void {
  const { subject, platform } = about;
  assertAssignees(input.addAssignees, platform);
  assertAssignees(input.removeAssignees, platform);
  assertLabels(input.addLabels, { field: "addLabels", platform });
  assertLabels(input.removeLabels, { field: "removeLabels", platform });
  if (input.title !== undefined && input.title.trim() === "") {
    throw new ForgesError(`${subject} title must not be empty`, 400, platform);
  }
  if (input.state !== undefined && input.state !== "open" && input.state !== "closed") {
    throw new ForgesError(`${subject} state must be "open" or "closed"`, 400, platform);
  }

  const assignees = overlap(
    { added: input.addAssignees, removed: input.removeAssignees },
    (login) => login.toLowerCase(),
  );
  const labels = overlap({ added: input.addLabels, removed: input.removeLabels }, (name) => name);
  const conflicts = [...assignees, ...labels];
  if (conflicts.length > 0) {
    throw new ForgesError(`Cannot both add and remove: ${conflicts.join(", ")}`, 400, platform);
  }

  const changes =
    input.title !== undefined ||
    input.body !== undefined ||
    input.state !== undefined ||
    [input.addAssignees, input.removeAssignees, input.addLabels, input.removeLabels].some(
      (list) => list !== undefined && list.length > 0,
    );
  if (!changes) {
    throw new ForgesError(`${subject} update needs at least one change`, 400, platform);
  }
}

export function assertIssueUpdate(input: UpdateIssueInput, platform?: string): void {
  assertUpdate(input, { subject: "Issue", platform });
}

export function assertPullRequestUpdate(input: UpdateIssueInput, platform?: string): void {
  assertUpdate(input, { subject: "Pull request", platform });
}

const MERGE_METHODS: ReadonlySet<unknown> = new Set(["merge", "squash", "rebase"]);

/** Rejects a merge method, head or title the platform would misread, before the merge goes out. */
export function assertMergeInput(input: MergePullRequestInput, platform?: string): void {
  if (input.method !== undefined && !MERGE_METHODS.has(input.method)) {
    throw new ForgesError('Merge method must be "merge", "squash" or "rebase"', 400, platform);
  }
  if (input.headSha !== undefined && input.headSha.trim() === "") {
    throw new ForgesError("Merge headSha must not be empty", 400, platform);
  }
  if (input.title !== undefined && input.title.trim() === "") {
    throw new ForgesError("Merge commit title must not be empty", 400, platform);
  }
}

/**
 * The assignee list after an update, for platforms that only take the whole list.
 * Current logins keep their order and spelling; added ones follow.
 */
export function nextAssignees(
  current: readonly string[],
  input: Pick<UpdateIssueInput, "addAssignees" | "removeAssignees">,
): string[] {
  const removed = new Set(input.removeAssignees?.map((login) => login.toLowerCase()));
  const next = current.filter((login) => !removed.has(login.toLowerCase()));
  const present = new Set(next.map((login) => login.toLowerCase()));
  for (const login of input.addAssignees ?? []) {
    if (present.has(login.toLowerCase())) continue;
    present.add(login.toLowerCase());
    next.push(login);
  }
  return next;
}

/** Whether the update touches assignees at all. */
export function changesAssignees(
  input: Pick<UpdateIssueInput, "addAssignees" | "removeAssignees">,
): boolean {
  return Boolean(input.addAssignees?.length || input.removeAssignees?.length);
}

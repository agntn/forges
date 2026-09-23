import { assertAssignees } from "./assignees.ts";
import { ForgesError } from "./errors.ts";
import type { UpdatePullRequestInput } from "./types.ts";

const MAX_LABELS = 100;

function assertLabels(labels: unknown, field: string, platform?: string): void {
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
  added: readonly string[] | undefined,
  removed: readonly string[] | undefined,
  key: (value: string) => string,
): string[] {
  if (!added?.length || !removed?.length) return [];
  const removedKeys = new Set(removed.map(key));
  return added.filter((value) => removedKeys.has(key(value)));
}

/**
 * Rejects an update that would change nothing or asks for two opposite things,
 * before any request goes out. Logins compare case-insensitively, as every
 * platform treats them; label names compare exactly.
 */
export function assertPullRequestUpdate(input: UpdatePullRequestInput, platform?: string): void {
  assertAssignees(input.addAssignees, platform);
  assertAssignees(input.removeAssignees, platform);
  assertLabels(input.addLabels, "addLabels", platform);
  assertLabels(input.removeLabels, "removeLabels", platform);
  if (input.title !== undefined && input.title.trim() === "") {
    throw new ForgesError("Pull request title must not be empty", 400, platform);
  }
  if (input.state !== undefined && input.state !== "open" && input.state !== "closed") {
    throw new ForgesError('Pull request state must be "open" or "closed"', 400, platform);
  }

  const assignees = overlap(input.addAssignees, input.removeAssignees, (login) =>
    login.toLowerCase(),
  );
  const labels = overlap(input.addLabels, input.removeLabels, (name) => name);
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
    throw new ForgesError("Pull request update needs at least one change", 400, platform);
  }
}

/**
 * The assignee list after an update, for platforms that only take the whole list.
 * Current logins keep their order and spelling; added ones follow.
 */
export function nextAssignees(
  current: readonly string[],
  input: Pick<UpdatePullRequestInput, "addAssignees" | "removeAssignees">,
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
  input: Pick<UpdatePullRequestInput, "addAssignees" | "removeAssignees">,
): boolean {
  return Boolean(input.addAssignees?.length || input.removeAssignees?.length);
}

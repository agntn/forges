import { ForgesError } from "./errors.ts";

export const MAX_ASSIGNEES = 10;

/** Rejects assignee input that no supported create API can accept safely. */
export function assertAssignees(assignees: unknown, platform?: string): void {
  if (assignees === undefined) return;
  if (
    !Array.isArray(assignees) ||
    assignees.length > MAX_ASSIGNEES ||
    assignees.some((login) => typeof login !== "string" || login.length === 0)
  ) {
    throw new ForgesError(
      `Assignees must be an array of at most ${MAX_ASSIGNEES} non-empty logins`,
      400,
      platform,
    );
  }
}

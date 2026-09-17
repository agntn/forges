import type { PullRequestReview, PullRequestReviewState } from "./types.ts";

const states: Record<string, PullRequestReviewState> = {
  approved: "approved",
  changes_requested: "changes_requested",
  request_changes: "changes_requested",
  requested_changes: "changes_requested",
  comment: "commented",
  commented: "commented",
  reviewed: "commented",
  dismissed: "dismissed",
  unapproved: "dismissed",
  pending: "pending",
};

/** A reviewer who was asked and has not answered has given no review. */
const requested = new Set(["request_review", "unreviewed", "review_started"]);

/**
 * Normalize a GitHub or Gitea review state, or a GitLab reviewer state. A request nobody
 * answered is null, a dismissed flag or a withdrawn approval is dismissed, an unknown state is
 * commented, the one verdict that neither approves nor blocks.
 */
export function normalizeReviewState(
  state: string,
  dismissed = false,
): PullRequestReviewState | null {
  const raw = state.toLowerCase();
  if (requested.has(raw)) return null;
  if (dismissed) return "dismissed";
  return states[raw] ?? "commented";
}

/** Keeps the reviews a mapper produced and drops the requests it returned null for. */
export function isPullRequestReview(review: PullRequestReview | null): review is PullRequestReview {
  return review !== null;
}

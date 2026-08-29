import type { CiRunConclusion, CiRunStatus } from "./types.ts";

const queuedStatuses = new Set([
  "created",
  "pending",
  "preparing",
  "queued",
  "requested",
  "scheduled",
  "waiting_for_callback",
  "waiting_for_resource",
]);

const waitingStatuses = new Set(["blocked", "manual", "waiting"]);

const activeStatuses = new Set(["canceling", "cancelling", "in_progress", "running"]);

const conclusions: Record<string, CiRunConclusion> = {
  action_required: "action_required",
  canceled: "cancelled",
  cancelled: "cancelled",
  failed: "failure",
  failure: "failure",
  neutral: "neutral",
  skipped: "skipped",
  stale: "stale",
  startup_failure: "startup_failure",
  success: "success",
  timed_out: "timed_out",
};

/** Normalize GitHub/Gitea workflow state and GitLab's combined pipeline state. */
export function normalizeCiRunState(
  status: string,
  conclusion?: string | null,
): { status: CiRunStatus; conclusion: CiRunConclusion } {
  const rawStatus = status.toLowerCase();
  const rawConclusion = conclusion?.toLowerCase() || rawStatus;
  const normalizedConclusion = conclusions[rawConclusion] ?? null;

  if (normalizedConclusion !== null || rawStatus === "completed") {
    return { status: "completed", conclusion: normalizedConclusion };
  }
  if (queuedStatuses.has(rawStatus)) {
    return { status: "queued", conclusion: null };
  }
  if (waitingStatuses.has(rawStatus)) {
    return { status: "waiting", conclusion: null };
  }
  if (activeStatuses.has(rawStatus)) {
    return { status: "in_progress", conclusion: null };
  }

  // Unknown non-terminal provider states must not be reported as completed.
  return { status: "in_progress", conclusion: null };
}

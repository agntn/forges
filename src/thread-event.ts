import type { PageResult, ThreadEvent, ThreadEventKind } from "./types.ts";

/** Every kind a timeline reports, keyed so a kind added to the type can't miss this list. */
const KINDS: Readonly<Record<ThreadEventKind, true>> = {
  comment: true,
  review: true,
  review_comment: true,
  commit: true,
  label: true,
  state_change: true,
  assignment: true,
  mention: true,
  referenced: true,
  reaction: true,
  issue_type: true,
  other: true,
};

/** The kinds a caller may filter on, in the order the tool schema lists them. */
export const THREAD_EVENT_KINDS = Object.keys(KINDS) as ThreadEventKind[];

export function isThreadEventKind(kind: unknown): kind is ThreadEventKind {
  return typeof kind === "string" && Object.hasOwn(KINDS, kind);
}

/** A kind such as `push` never sits on a timeline, so it reads as `other`. */
export function threadEventKind(kind: string): ThreadEventKind {
  return isThreadEventKind(kind) ? kind : "other";
}

/** One page narrowed to `kinds`; a count of the whole timeline no longer describes it. */
export function eventsOfKinds(
  page: PageResult<ThreadEvent>,
  kinds: ReadonlySet<ThreadEventKind>,
): PageResult<ThreadEvent> {
  const { totalCount: _total, ...rest } = page;
  return { ...rest, items: page.items.filter((event) => kinds.has(event.kind)) };
}

import { quoted } from "./issue-fields.ts";
import { delay, MAX_SCAN_PAGES, MAX_WAIT_SECONDS, nextPollDelay } from "./poll.ts";
import type { Comment, PageResult, Reaction } from "./types.ts";

/** Reads one page of a discussion listing at a cursor; a scan calls it until the last page. */
export type ReadDiscussionPage<T> = (cursor: string | undefined) => Promise<PageResult<T>>;

/** What one bounded wait did, reported next to the items it returns. */
export interface DiscussionWait {
  /** True once a matching comment or reaction changed; false when the budget ran out first. */
  settled: boolean;
  waitedMs: number;
  polls: number;
}

export interface ReactionWait extends DiscussionWait {
  /** Reactions the first read saw and a later one no longer did, like a bot's eyes going away. */
  removed: Reaction[];
}

/** Which comments count: those carrying a marker, those touched since a time, or both. */
export interface CommentFilter {
  marker?: string;
  since?: string;
}

/** Which reactions count: those from one account, those left since a time, or both. */
export interface ReactionFilter {
  author?: string;
  since?: string;
}

export interface DiscussionReadOptions {
  waitSeconds?: number;
}

export interface DiscussionResult<T, W extends DiscussionWait> {
  page: PageResult<T> & { wait?: W };
  /** Set when the answer is partial or the wait ended without a change. */
  note: string | undefined;
}

interface Scan<T> {
  items: T[];
  /** False when the listing outran the scan bound, so its end was never seen. */
  examinedEveryPage: boolean;
}

/** The whole listing, so a sticky comment on page three settles the wait like one on page one. */
async function scanAll<T>(read: ReadDiscussionPage<T>): Promise<Scan<T>> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let visited = 0; visited < MAX_SCAN_PAGES; visited += 1) {
    const page = await read(cursor);
    items.push(...page.items);
    if (page.nextCursor === undefined) return { items, examinedEveryPage: true };
    cursor = page.nextCursor;
  }
  return { items, examinedEveryPage: false };
}

function partialNote(subject: "comments" | "reactions"): string {
  const narrow = subject === "comments" ? "; narrow it with since" : "";
  return `The read stopped after ${MAX_SCAN_PAGES} pages of ${subject} without reaching the end, so a match further on is missing${narrow}.`;
}

function sinceMs(since: string | undefined): number | undefined {
  return since === undefined ? undefined : Date.parse(since);
}

/** Logins compare without case, as every forge treats them. */
function sameLogin(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

interface Polled<T, C> {
  scan: Scan<T>;
  /** What changed against the baseline, or nothing when the wait ended without a change. */
  change: C | undefined;
  wait: DiscussionWait;
}

/** Polls until `change` finds something, a scan comes back partial, or the budget runs out. */
async function pollForChange<T, C>(
  first: Scan<T>,
  poll: Readonly<{
    read: () => Promise<Scan<T>>;
    change: (scan: Scan<T>) => C | undefined;
    waitSeconds: number;
  }>,
): Promise<Polled<T, C>> {
  const budgetMs = Math.min(poll.waitSeconds, MAX_WAIT_SECONDS) * 1_000;
  const startedAt = performance.now();
  let polls = 1;
  let scan = first;
  while (true) {
    const change = scan.examinedEveryPage ? poll.change(scan) : undefined;
    const waitedMs = Math.round(performance.now() - startedAt);
    const settled = change !== undefined;
    if (settled || !scan.examinedEveryPage || waitedMs >= budgetMs) {
      return { scan, change, wait: { settled, waitedMs, polls } };
    }
    await delay(nextPollDelay(polls, budgetMs - waitedMs));
    scan = await poll.read();
    polls += 1;
  }
}

function timeoutNote(waitSeconds: number, what: string): string {
  return `${what} within the ${waitSeconds}s budget. Call again with waitSeconds to keep waiting; a bot still working hasn't finished its round.`;
}

function nonEmpty<T>(items: T[]): T[] | undefined {
  return items.length > 0 ? items : undefined;
}

/** With since, any edit from then on settles it; without, the next change after the first read. */
export async function readComments(
  read: ReadDiscussionPage<Comment>,
  options: CommentFilter & DiscussionReadOptions,
): Promise<DiscussionResult<Comment, DiscussionWait>> {
  const { marker, since, waitSeconds } = options;
  const from = sinceMs(since);
  const keep = (comment: Comment) =>
    (marker === undefined || comment.body.includes(marker)) &&
    (from === undefined || Date.parse(comment.updatedAt) >= from);
  const scanKept = async () => {
    const scan = await scanAll(read);
    return { ...scan, items: scan.items.filter(keep) };
  };

  const first = await scanKept();
  if (waitSeconds === undefined) {
    const note = first.examinedEveryPage ? undefined : partialNote("comments");
    return { page: { items: first.items }, note };
  }

  const seen = new Map(first.items.map((comment) => [comment.id, comment.updatedAt]));
  const polled = await pollForChange(first, {
    read: scanKept,
    change: (scan) =>
      nonEmpty(
        from === undefined
          ? scan.items.filter((comment) => seen.get(comment.id) !== comment.updatedAt)
          : scan.items,
      ),
    waitSeconds,
  });
  return {
    page: { items: polled.change ?? [], wait: polled.wait },
    note: commentWaitNote(polled, { marker, since, waitSeconds }),
  };
}

function commentWaitNote(
  polled: Polled<Comment, Comment[]>,
  options: CommentFilter & { waitSeconds: number },
): string | undefined {
  if (polled.wait.settled) return undefined;
  if (!polled.scan.examinedEveryPage) return partialNote("comments");
  const { marker, since, waitSeconds } = options;
  const which = marker === undefined ? "No comment" : "No comment carrying the marker";
  const when = since === undefined ? "after the call started" : `since ${quoted(since)}`;
  return timeoutNote(waitSeconds, `${which} was created or edited ${when}`);
}

/** Who reacted with what, and when; a forge returns no id for a reaction. */
function reactionKey(reaction: Reaction): string {
  return JSON.stringify([reaction.user.login.toLowerCase(), reaction.content, reaction.createdAt]);
}

interface ReactionChange {
  landed: Reaction[];
  removed: Reaction[];
}

/** A reaction that lands settles the wait, and so does one going away, as a bot's eyes do. */
export async function readReactions(
  read: ReadDiscussionPage<Reaction>,
  options: ReactionFilter & DiscussionReadOptions,
): Promise<DiscussionResult<Reaction, ReactionWait>> {
  const { author, since, waitSeconds } = options;
  const from = sinceMs(since);
  const recent = (reaction: Reaction) =>
    from === undefined || Date.parse(reaction.createdAt) >= from;
  const scanAuthored = async () => {
    const scan = await scanAll(read);
    if (author === undefined) return scan;
    return { ...scan, items: scan.items.filter((item) => sameLogin(item.user.login, author)) };
  };

  const first = await scanAuthored();
  if (waitSeconds === undefined) {
    const note = first.examinedEveryPage ? undefined : partialNote("reactions");
    return { page: { items: first.items.filter(recent) }, note };
  }

  const seen = new Set(first.items.map(reactionKey));
  const polled = await pollForChange<Reaction, ReactionChange>(first, {
    read: scanAuthored,
    change: (scan) => {
      const now = new Set(scan.items.map(reactionKey));
      const removed = first.items.filter((reaction) => !now.has(reactionKey(reaction)));
      const landed = scan.items.filter((reaction) =>
        from === undefined ? !seen.has(reactionKey(reaction)) : recent(reaction),
      );
      return landed.length > 0 || removed.length > 0 ? { landed, removed } : undefined;
    },
    waitSeconds,
  });
  const wait: ReactionWait = { ...polled.wait, removed: polled.change?.removed ?? [] };
  return {
    page: { items: polled.change?.landed ?? [], wait },
    note: reactionWaitNote(polled, { author, since, waitSeconds }),
  };
}

function reactionWaitNote(
  polled: Polled<Reaction, ReactionChange>,
  options: ReactionFilter & { waitSeconds: number },
): string | undefined {
  if (polled.wait.settled) return undefined;
  if (!polled.scan.examinedEveryPage) return partialNote("reactions");
  const { author, since, waitSeconds } = options;
  const who = author === undefined ? "" : ` from ${quoted(author)}`;
  const when = since === undefined ? "after the call started" : `since ${quoted(since)}`;
  return timeoutNote(waitSeconds, `No reaction${who} landed ${when}, and none went away`);
}

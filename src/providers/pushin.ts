/**
 * Pushin.eu provider implementation
 * GitHub shaped REST on pushin.eu/api/v1, built on `forges/pushin`, with key differences:
 * - Review threads come from the pull request's inline comments, resolved by their root
 * - Commits, contents, CI runs, tags and other people's repositories have no REST route
 */

import type {
  Actor,
  ForgeProvider as Forge,
  ReviewComment,
  Thread as ForgeThread,
  ThreadRef,
} from "forges";
import { pushin } from "forges/pushin";

import { ForgeBackedProvider, type ForgeOptions } from "./forge.ts";
import { conversationsOf, type ReviewConversation } from "./forge-model.ts";
import { encodePathSegment, normalizeApiBaseURL } from "./base-url.ts";
import { ForgesError } from "../errors.ts";
import { parseLinkHeader } from "../pagination.ts";
import { assertProviderConfig } from "../provider-config.ts";
import type { ProviderConfig, PullRequest } from "../types.ts";

const PLATFORM = "pushin";

/** Rows one page of inline comments asks for, the most Pushin.eu serves. */
const COMMENT_PAGE = 100;

/** Pages read before a pull request's threads count as too many to list. */
const MAX_COMMENT_PAGES = 20;

/** One row of `GET …/pulls/:number/comments`, the fields the threads read. */
interface PushinReviewComment {
  id: number;
  body: string;
  user: { id?: number; login: string | null } | null;
  path: string | null;
  line: number | null;
  start_line: number | null;
  side: "LEFT" | "RIGHT" | null;
  in_reply_to_id: number | null;
  resolved: boolean;
  html_url: string;
  created_at: string;
}

/** The part of a pull request payload the shared model drops. */
interface PushinPull {
  merge_commit_sha?: string | null;
}

/** An imported author has no id, so the login stands in. */
function authorOf(
  { forge, instance }: Readonly<ThreadRef>,
  user: Readonly<{ id?: number; login: string | null }>,
): Actor {
  const login = user.login ?? "";
  const id = user.id === undefined ? login : String(user.id);
  return { forge, instance, login, id, isBotHint: false };
}

function reviewCommentOf(
  thread: Readonly<ThreadRef & { number: string }>,
  raw: Readonly<PushinReviewComment>,
): ReviewComment {
  const id = String(raw.id);
  const root = raw.in_reply_to_id === null ? id : String(raw.in_reply_to_id);
  return {
    ref: { forge: thread.forge, instance: thread.instance, thread, id },
    body: raw.body,
    ...(raw.user?.login ? { author: authorOf(thread, raw.user) } : {}),
    ...(raw.path === null ? {} : { path: raw.path }),
    ...(raw.line === null ? {} : { line: raw.line }),
    ...(raw.in_reply_to_id === null ? {} : { inReplyTo: root }),
    thread: { id: root, resolved: raw.resolved },
    createdAt: new Date(raw.created_at),
    url: raw.html_url,
    raw,
  };
}

/** Conversations with the first line of a range their root comment covers. */
function withRanges(comments: readonly ReviewComment[]): ReviewConversation[] {
  return conversationsOf(comments).map((conversation) => {
    const start = (conversation.comments[0]?.raw as PushinReviewComment | undefined)?.start_line;
    return start === null || start === undefined
      ? conversation
      : { ...conversation, startLine: start };
  });
}

/** Pushin.eu on the shared `forges` mapping, threads read from inline comments. */
export class PushinProvider extends ForgeBackedProvider {
  /**
   * Create a Pushin.eu provider.
   *
   * @param config Provider configuration. `baseURL` defaults to `https://pushin.eu/api/v1`.
   */
  constructor(config: ProviderConfig) {
    assertProviderConfig(config, PLATFORM);
    super(PLATFORM, {
      apiBaseURL: normalizeApiBaseURL(config.baseURL, {
        fallbackBaseURL: "https://pushin.eu/api/v1",
        apiPath: "/api/v1",
      }),
      token: config.token ?? "",
    });
  }

  protected override createForge(options: ForgeOptions): Forge {
    return pushin(options) as Forge;
  }

  /** `forges` keeps `merge_commit_sha` in `raw` alone. */
  protected override mapPullRequest(thread: never): PullRequest {
    const mapped = super.mapPullRequest(thread);
    const sha = ((thread as ForgeThread).raw as PushinPull).merge_commit_sha;
    return mapped.merged && sha ? { ...mapped, mergeCommitSha: sha } : mapped;
  }

  /** Pushin.eu leaves standalone inline comments out of every review. */
  protected override async readConversations(
    _forge: Forge,
    ref: ThreadRef,
  ): Promise<ReviewConversation[]> {
    const thread = { ...ref, number: ref.number ?? "" };
    const owner = encodePathSegment(ref.repo.owner, "Owner");
    const name = encodePathSegment(ref.repo.name, "Repository name");
    const number = encodePathSegment(thread.number, "Pull request number");
    const route = `/repos/${owner}/${name}/pulls/${number}/comments`;
    const comments: ReviewComment[] = [];
    for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
      const { data, headers } = await this.client.raw<PushinReviewComment[]>(route, {
        query: { per_page: COMMENT_PAGE, page },
      });
      comments.push(...(data ?? []).map((raw) => reviewCommentOf(thread, raw)));
      if (parseLinkHeader(headers.get("Link")).next === undefined) return withRanges(comments);
    }
    throw new ForgesError(
      `Pull request #${number} has more than ${MAX_COMMENT_PAGES * COMMENT_PAGE} inline comments`,
      { status: 413, platform: PLATFORM },
    );
  }
}

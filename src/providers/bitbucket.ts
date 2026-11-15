/**
 * Bitbucket Cloud provider implementation
 * API 2.0, built on `forges/bitbucket`, with key differences:
 * - The owner is a workspace, and there are no issues, releases or CI runs to read
 * - Inline review comments share one list with the conversation, told apart by `inline`
 * - A review thread is an opening inline comment and its replies, resolved through `/resolve`
 * - Pages come from the `next` link in the body
 */

import type { ForgeProvider as Forge } from "forges";
import { bitbucket } from "forges/bitbucket";

import { ForgeBackedProvider, type ForgeOptions } from "./forge.ts";
import { encodePathSegment, normalizeApiBaseURL } from "./base-url.ts";
import { ForgesError, NotFoundError, normalizeError } from "../errors.ts";
import {
  assertContinuationRef,
  assertFileSize,
  buildRepositoryFileFromBytes,
  encodeRepositoryPath,
  isCommitSha,
} from "../repository-contents.ts";
import { slicePage } from "../pagination.ts";
import type { ContinuedPage, NumberedPage, Positioned, WithPage } from "../provider.ts";
import type {
  CiJob,
  CiRun,
  Comment,
  CommitSummary,
  CreateCommentInput,
  CreateIssueInput,
  Issue,
  IssueRef,
  ListCiJobsOptions,
  ListCiRunsOptions,
  ListCommentOptions,
  ListCommitOptions,
  ListOptions,
  ListReleasesOptions,
  ListThreadOptions,
  Release,
  ReplyThreadInput,
  RepoRef,
  RepositoryContents,
  RepositoryContentsOptions,
  RepositoryEntry,
  Thread,
  ThreadComment,
  User,
} from "../types.ts";

const PLATFORM = "bitbucket";

/** Bitbucket caps `pagelen` at 100 on comments and source listings. */
const MAX_PAGE_LENGTH = 100;

/** Pages read before a directory listing is called incomplete. */
const MAX_TREE_PAGES = 10;

/** A user or account as Bitbucket sends it. */
interface BitbucketAccount {
  display_name?: string;
  nickname?: string;
  uuid?: string;
}

/** One pull request comment, conversation and inline alike. */
interface BitbucketComment {
  id: number;
  created_on: string;
  updated_on?: string;
  deleted?: boolean;
  content?: { raw?: string };
  user?: BitbucketAccount;
  parent?: { id: number };
  inline?: {
    path: string;
    from?: number | null;
    to?: number | null;
    start_from?: number | null;
    start_to?: number | null;
  };
  /** Present, as an object, only while the thread it opens is resolved. */
  resolution?: object | null;
  links?: { html?: { href?: string } };
}

/** One entry of a `src` listing. */
interface BitbucketTreeEntry {
  path: string;
  type: "commit_file" | "commit_directory";
  size?: number;
  attributes?: string[];
  commit?: { hash?: string };
}

/** `format=meta` of a `src` path: a file or a directory at one commit. */
interface BitbucketSourceMeta {
  path: string;
  type: "commit_file" | "commit_directory";
  size?: number;
  commit: { hash: string };
}

interface BitbucketPage<T> {
  values: T[];
  next?: string;
}

/** What Bitbucket Cloud doesn't have, as the refusal names it. */
function missing(feature: string): Promise<never> {
  return Promise.reject(
    new ForgesError(`Bitbucket Cloud has no ${feature}`, { status: 501, platform: PLATFORM }),
  );
}

/** Nickname first, as Bitbucket shows people, then the name and the uuid it always has. */
function accountLogin(account: BitbucketAccount | undefined): string {
  return account?.nickname ?? account?.display_name ?? account?.uuid ?? "";
}

function threadComment(comment: BitbucketComment): ThreadComment {
  return {
    id: String(comment.id),
    body: comment.content?.raw ?? "",
    author: { login: accountLogin(comment.user) },
    url: comment.links?.html?.href ?? "",
    createdAt: comment.created_on,
  };
}

/** The comment a reply chain starts from; a parent outside the list ends the walk. */
function rootOf(
  comment: BitbucketComment,
  byId: ReadonlyMap<number, BitbucketComment>,
): BitbucketComment {
  let current = comment;
  const seen = new Set<number>();
  while (current.parent !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parent.id);
    if (parent === undefined) return current;
    current = parent;
  }
  return current;
}

/**
 * Review threads from a pull request's comments, oldest first, keyed by the opening comment.
 *
 * @param comments - Every comment of the pull request, deleted ones included.
 * @returns {Thread[]} One thread per live opening inline comment, with its live replies.
 */
export function bitbucketThreads(comments: readonly BitbucketComment[]): Thread[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const threads = new Map<number, { root: BitbucketComment; replies: BitbucketComment[] }>();
  for (const comment of comments) {
    const root = rootOf(comment, byId);
    if (root.inline === undefined || root.deleted === true) continue;
    const thread = threads.get(root.id) ?? { root, replies: [] };
    threads.set(root.id, thread);
    if (comment !== root && comment.deleted !== true) thread.replies.push(comment);
  }
  return [...threads.values()].map(({ root, replies }) => {
    const inline = root.inline;
    const start = inline?.start_to ?? inline?.start_from ?? null;
    return {
      id: String(root.id),
      isResolved: root.resolution !== undefined && root.resolution !== null,
      isOutdated: false,
      path: inline?.path ?? "",
      line: inline?.to ?? inline?.from ?? null,
      startLine: start,
      comments: [root, ...replies].map(threadComment),
    };
  });
}

function conversationComment(comment: BitbucketComment): Comment {
  return { ...threadComment(comment), updatedAt: comment.updated_on ?? comment.created_on };
}

function entryOf(entry: BitbucketTreeEntry, path: string): RepositoryEntry {
  const name = entry.path.slice(path === "" ? 0 : path.length + 1);
  const type =
    entry.type === "commit_directory"
      ? "directory"
      : entry.attributes?.includes("link")
        ? "symlink"
        : entry.attributes?.includes("subrepository")
          ? "submodule"
          : "file";
  return { name, path: entry.path, type, size: type === "file" ? (entry.size ?? null) : null };
}

/**
 * Bitbucket Cloud provider.
 *
 * Pull requests, their comments, review threads, checks, commits, tags and files read like on
 * any forge. Issues, releases, CI runs and other users' profiles answer 501.
 */
export class BitbucketProvider extends ForgeBackedProvider {
  readonly #username: string | undefined;

  /**
   * Create a Bitbucket Cloud provider.
   *
   * @param config Provider configuration. `baseURL` defaults to `https://api.bitbucket.org/2.0`,
   * and `username` turns `token` into an API token sent with basic auth.
   */
  constructor(config: import("../types.ts").ProviderConfig) {
    super(PLATFORM, {
      apiBaseURL: normalizeApiBaseURL(config.baseURL, {
        fallbackBaseURL: "https://api.bitbucket.org/2.0",
        apiPath: "/2.0",
      }),
      token: config.token ?? "",
    });
    this.#username = config.username;
  }

  /** An API token with its email goes as basic auth, anything else as a bearer. */
  protected override createForge(options: ForgeOptions): Forge {
    const { auth } = options;
    return bitbucket({
      ...options,
      auth:
        auth.type === "token" && this.#username !== undefined
          ? { type: "basic", username: this.#username, password: auth.token }
          : auth,
    }) as Forge;
  }

  /** `/repositories/:workspace/:slug`, each part one segment. */
  #repoPath({ owner, repo }: RepoRef): string {
    return `/repositories/${encodePathSegment(owner, "Workspace")}/${encodePathSegment(repo, "Repository name")}`;
  }

  #commentsPath({ number, ...repo }: IssueRef): string {
    return `${this.#repoPath(repo)}/pullrequests/${encodePathSegment(number, "Number")}/comments`;
  }

  /** Every comment of a pull request, deleted ones included so a reply finds its thread. */
  async #allComments(pull: IssueRef): Promise<BitbucketComment[]> {
    const comments: BitbucketComment[] = [];
    let url: string | undefined = this.#commentsPath(pull);
    let query: Record<string, unknown> | undefined = { pagelen: MAX_PAGE_LENGTH };
    while (url !== undefined) {
      const page: BitbucketPage<BitbucketComment> = await this.client(url, { query });
      comments.push(...page.values);
      url = page.next;
      query = undefined;
    }
    return comments;
  }

  /** No issues to mistake for a pull request, so a missing one is the comments' 404. */
  async #threads(pull: IssueRef): Promise<Thread[]> {
    return bitbucketThreads(await this.#allComments(pull));
  }

  async #thread(pull: IssueRef, threadId: string): Promise<Thread> {
    const thread = (await this.#threads(pull)).find((candidate) => candidate.id === threadId);
    if (thread === undefined) {
      throw new NotFoundError(`Thread not found: ${threadId}`, { platform: PLATFORM });
    }
    return thread;
  }

  /**
   * The conversation leaves out inline comments, which are review threads, and deleted ones,
   * which Bitbucket keeps as empty bodies. The filter runs on the server, so pages stay full.
   */
  protected override async listPullRequestComments(
    pull: IssueRef,
    options?: Positioned<ListCommentOptions>,
  ): Promise<ContinuedPage<Comment>> {
    try {
      const at = options?.at;
      const url = at !== undefined && "url" in at ? at.url : this.#commentsPath(pull);
      const query =
        at === undefined
          ? {
              q: "(deleted=false) AND (inline.path=null)",
              pagelen: Math.min(options?.perPage ?? 30, MAX_PAGE_LENGTH),
            }
          : undefined;
      if (at !== undefined && !("url" in at)) {
        throw new ForgesError("cursor is not one this listing returned", {
          status: 400,
          platform: PLATFORM,
        });
      }
      const page: BitbucketPage<BitbucketComment> = await this.client(url, { query });
      return {
        items: page.values.map(conversationComment),
        ...(page.next === undefined ? {} : { next: { url: page.next } }),
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /** Found in this pull request's own list, so an id from another one is missing. */
  protected override async getPullRequestComment(
    pull: IssueRef,
    { commentId }: { commentId: string },
  ): Promise<Comment> {
    try {
      const comment = (await this.#allComments(pull)).find(
        (candidate) => String(candidate.id) === commentId,
      );
      if (comment === undefined || comment.deleted === true || comment.inline !== undefined) {
        throw new NotFoundError(`Comment not found: ${commentId}`, { platform: PLATFORM });
      }
      return conversationComment(comment);
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override readCommentToWrite(
    home: Readonly<IssueRef & { kind: "issue" | "pull_request" }>,
    { commentId }: { commentId: string },
  ): Promise<Comment> {
    if (home.kind === "issue") return missing("issues");
    return this.getPullRequestComment(home, { commentId });
  }

  protected override async createPullRequestComment(
    pull: IssueRef,
    { body }: CreateCommentInput,
  ): Promise<Comment> {
    try {
      return conversationComment(
        await this.client<BitbucketComment>(this.#commentsPath(pull), {
          method: "POST",
          body: { content: { raw: body } },
        }),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async listThreads(
    pull: IssueRef,
    options?: WithPage<ListThreadOptions>,
  ): Promise<NumberedPage<Thread>> {
    try {
      return slicePage(
        this.filterThreadsByState(await this.#threads(pull), options?.state),
        options,
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getThread(
    pull: IssueRef,
    { threadId }: { threadId: string },
  ): Promise<Thread> {
    try {
      return await this.#thread(pull, threadId);
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /** The reply goes under the newest comment, so it lands at the end of the thread. */
  protected override async replyToThread(
    pull: IssueRef,
    { threadId, body }: ReplyThreadInput & { threadId: string },
  ): Promise<ThreadComment> {
    try {
      const thread = await this.#thread(pull, threadId);
      const parent = thread.comments.at(-1)?.id ?? threadId;
      return threadComment(
        await this.client<BitbucketComment>(this.#commentsPath(pull), {
          method: "POST",
          body: { content: { raw: body }, parent: { id: Number(parent) } },
        }),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override resolveThread(
    pull: IssueRef,
    { threadId }: { threadId: string },
  ): Promise<Thread> {
    return this.#setResolved(pull, { threadId, resolved: true });
  }

  protected override unresolveThread(
    pull: IssueRef,
    { threadId }: { threadId: string },
  ): Promise<Thread> {
    return this.#setResolved(pull, { threadId, resolved: false });
  }

  /** Bitbucket refuses a repeat with a 409 or a 404, so the state is read first. */
  async #setResolved(
    pull: IssueRef,
    change: Readonly<{ threadId: string; resolved: boolean }>,
  ): Promise<Thread> {
    try {
      const thread = await this.#thread(pull, change.threadId);
      if (thread.isResolved === change.resolved) return thread;
      await this.client(`${this.#commentsPath(pull)}/${encodePathSegment(thread.id)}/resolve`, {
        method: change.resolved ? "POST" : "DELETE",
        responseType: "text",
      });
      return { ...thread, isResolved: change.resolved };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async readRepositoryContents(
    ref: RepoRef,
    { path, ...options }: RepositoryContentsOptions & { path: string },
  ): Promise<RepositoryContents> {
    try {
      const route = this.#repoPath(ref);
      const sha = isCommitSha(options.ref)
        ? options.ref
        : await this.forgeCall((forge) =>
            forge.contents.resolveRef(this.repoRef(forge, ref), options.ref ?? "HEAD"),
          );
      assertContinuationRef(options, sha);
      const source = `${route}/src/${sha}/${path === "" ? "" : encodeRepositoryPath(path)}`;
      const meta = await this.client<BitbucketSourceMeta>(source, { query: { format: "meta" } });
      if (meta.type === "commit_file") {
        assertFileSize(path, meta.size ?? 0);
        const bytes = await this.client<ArrayBuffer, "arrayBuffer">(source, {
          responseType: "arrayBuffer",
        });
        return buildRepositoryFileFromBytes({ path, sha, bytes: new Uint8Array(bytes) }, options);
      }
      return await this.#directory(source, { path, sha });
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  async #directory(
    source: string,
    { path, sha }: Readonly<{ path: string; sha: string }>,
  ): Promise<RepositoryContents> {
    const entries: RepositoryEntry[] = [];
    let url: string | undefined = path === "" || source.endsWith("/") ? source : `${source}/`;
    let query: Record<string, unknown> | undefined = { pagelen: MAX_PAGE_LENGTH };
    for (let page = 0; url !== undefined; page++) {
      if (page === MAX_TREE_PAGES)
        return { type: "directory", path, sha, entries, entriesComplete: false };
      const listing: BitbucketPage<BitbucketTreeEntry> = await this.client(url, { query });
      entries.push(...listing.values.map((entry) => entryOf(entry, path)));
      url = listing.next;
      query = undefined;
    }
    return { type: "directory", path, sha, entries, entriesComplete: true };
  }

  protected override listIssues(
    _repo: RepoRef,
    _options?: Positioned<ListOptions>,
  ): Promise<never> {
    return missing("issues");
  }

  protected override getIssue(_issue: IssueRef): Promise<Issue> {
    return missing("issues");
  }

  protected override createIssue(_repo: RepoRef, _input: CreateIssueInput): Promise<Issue> {
    return missing("issues");
  }

  protected override listIssueComments(
    _issue: IssueRef,
    _options?: Positioned<ListCommentOptions>,
  ): Promise<never> {
    return missing("issues");
  }

  protected override getIssueComment(
    _issue: IssueRef,
    _comment: { commentId: string },
  ): Promise<Comment> {
    return missing("issues");
  }

  protected override listIssueEvents(_issue: IssueRef): Promise<never> {
    return missing("issues");
  }

  protected override listReleases(
    _repo: RepoRef,
    _options?: Positioned<ListReleasesOptions>,
  ): Promise<never> {
    return missing("releases");
  }

  protected override getRelease(_repo: RepoRef, _release: { tag: string }): Promise<Release> {
    return missing("releases");
  }

  protected override createRelease(): Promise<Release> {
    return missing("releases");
  }

  protected override updateRelease(): Promise<Release> {
    return missing("releases");
  }

  /** The commit log has no date filter, so `since` and `until` would come back ignored. */
  protected override listCommits(
    repo: RepoRef,
    options?: Positioned<ListCommitOptions>,
  ): Promise<ContinuedPage<CommitSummary>> {
    if (options?.since !== undefined || options?.until !== undefined) {
      return Promise.reject(
        new ForgesError(
          "Bitbucket Cloud filters commits by ref and path only. Drop since and until",
          {
            status: 501,
            platform: PLATFORM,
          },
        ),
      );
    }
    return super.listCommits(repo, options);
  }

  /** Pipelines don't map to runs in `forges` yet; their statuses show up as checks. */
  protected override listCiRuns(
    _repo: RepoRef,
    _options?: Positioned<ListCiRunsOptions>,
  ): Promise<NumberedPage<CiRun>> {
    return missing("CI-run listing here: read a commit's or pull request's checks instead");
  }

  protected override listCiJobs(
    _repo: RepoRef,
    _options: Positioned<ListCiJobsOptions> & { runId: string },
  ): Promise<ContinuedPage<CiJob>> {
    return missing("CI-job listing here: read a commit's or pull request's checks instead");
  }

  /** Bitbucket profiles go by account id, not by name. */
  protected override getUser(_username: string): Promise<User> {
    return missing("profile lookup by username");
  }
}

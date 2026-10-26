/**
 * Shared base for the providers built on `forges`.
 *
 * `forges` sends the requests, picks the endpoints and walks the pages, and
 * the base maps its model, so a provider for a forge `forges` knows needs only
 * its factory. A provider with more to say maps the forge's own payload, which
 * `forges` keeps as `raw`, and overrides the operations it serves better.
 */

import { sha256 } from "@agntn/hashes/sha2";
import type {
  Actor,
  Comment as ForgeComment,
  Cursor,
  ForgeListing,
  ForgeProvider as Forge,
  Page,
  ReleaseRef,
  Repo,
  RepoRef as ForgeRepoRef,
  Thread as ForgeThread,
  ThreadKind,
  ThreadRef,
  User as ForgeUser,
} from "forges";

import type { PagePosition } from "../cursor.ts";

import { encodePathSegment, encodeRefPathSegment } from "./base-url.ts";
import {
  changedFileFromModel,
  checkFromModel,
  ciJobFromModel,
  ciRunFromModel,
  commentFromModel,
  commitFromModel,
  commitSummaryFromModel,
  issueFromModel,
  ownerFromModel,
  pullRequestFromModel,
  releaseFromModel,
  repositoryFromModel,
  reviewConversations,
  tagFromModel,
  threadCommentFromModel,
  threadFromModel,
  userFromModel,
  type ReviewConversation,
} from "./forge-model.ts";
import { ForgesError, normalizeError, NotFoundError } from "../errors.ts";
import {
  createForgeClient,
  credentialScope,
  forgeFetch,
  toFetchError,
  type HttpClient,
} from "../http.ts";
import { version } from "../version.ts";
import { slicePage } from "../pagination.ts";
import {
  Provider,
  type ContinuedPage,
  type NumberedPage,
  type Positioned,
  type ProviderRawTypes,
  type WithPage,
} from "../provider.ts";
import type {
  CiJob,
  CiRun,
  Commit,
  CommitSummary,
  Comment,
  CreateIssueInput,
  CreatePullRequestInput,
  CreateReleaseInput,
  Issue,
  IssueRef,
  ListCommentOptions,
  ListCommitChecksOptions,
  ListPullRequestChecksOptions,
  ListPullRequestFilesOptions,
  ListThreadOptions,
  Owner,
  PullRequest,
  PullRequestCheck,
  PullRequestFile,
  ListCiJobsOptions,
  ListCiRunsOptions,
  ListCommitOptions,
  ListOptions,
  ListReleasesOptions,
  ListTagsOptions,
  Release,
  ReplyThreadInput,
  RepoRef,
  Repository,
  Tag,
  Thread,
  ThreadComment,
  UpdateReleaseInput,
  User,
} from "../types.ts";

/** The rows a page holds when the caller names no size; GitLab alone would send 20. */
const DEFAULT_PER_PAGE = 30;

/** What every `forges` factory here is opened with. */
export interface ForgeOptions {
  baseUrl: string;
  auth: { type: "anonymous" } | { type: "token"; token: string };
  userAgent: string;
  fetch: typeof forgeFetch;
}

/** One release of a repository, by its tag. */
export type ReleaseTag = Readonly<RepoRef & { tag: string }>;

/** An issue or pull request, with which of the two the caller expects it to be. */
export type KindedIssue = Readonly<IssueRef & { pullRequest: boolean }>;

/** One review thread on a pull request. */
export type ReviewThreadRef = Readonly<IssueRef & { threadId: string }>;

/** An issue or pull request with the `forges` thread kind it is read as. */
type KindedThread = Readonly<IssueRef & { kind: ThreadKind }>;

/** Page options as `forges` reads them. */

interface ForgePageOptions {
  perPage?: number;
  cursor?: Cursor;
}

export abstract class ForgeBackedProvider<
  Raw extends ProviderRawTypes = ProviderRawTypes,
> extends Provider<Raw> {
  /** Requests the `forges` model does not cover, sent through the same provider. */
  protected readonly client: HttpClient;
  readonly #platform: string;
  readonly #apiBaseURL: string;
  readonly #token: string;
  readonly #cursorKey: Uint8Array;
  #forge: Promise<Forge> | undefined;
  #refreshed: Promise<unknown> | undefined;
  #refreshDone = false;

  protected constructor(
    platform: string,
    { apiBaseURL, token }: Readonly<{ apiBaseURL: string; token: string }>,
  ) {
    super(platform);
    this.#platform = platform;
    this.#apiBaseURL = apiBaseURL;
    this.#token = token;
    this.#cursorKey = sha256(Buffer.from(JSON.stringify(["cursor", platform, apiBaseURL, token])));
    this.client = createForgeClient(() => this.#open(), {
      scope: credentialScope(apiBaseURL, token),
    });
  }

  /** The `forges` factory for this platform; called once, on the first request. */
  protected abstract createForge(options: ForgeOptions): Forge;

  /** What the mappers read: the model item here, `raw` in a provider that maps its forge's own. */
  protected forgePayload(item: Readonly<{ raw: unknown }>): unknown {
    return item;
  }

  protected override mapOwner(actor: Raw["owner"]): Owner {
    return ownerFromModel(actor as Actor);
  }

  protected override mapRepository(repo: Raw["repository"]): Repository {
    return repositoryFromModel(repo as Repo);
  }

  protected override mapIssue(thread: Raw["issue"]): Issue {
    return issueFromModel(thread as ForgeThread);
  }

  protected override mapPullRequest(thread: Raw["pullRequest"]): PullRequest {
    return pullRequestFromModel(thread as ForgeThread);
  }

  protected override mapUser(user: Raw["user"]): User {
    return userFromModel(user as ForgeUser);
  }

  /** Review conversations have no payload of their own, so the operations below map them directly. */
  protected override mapThread(conversation: Raw["thread"]): Thread {
    return threadFromModel(conversation as ReviewConversation);
  }

  protected override mapComment(comment: Raw["comment"]): Comment {
    return commentFromModel(comment as ForgeComment);
  }

  protected mapRelease(release: never): Release {
    return releaseFromModel(release);
  }

  protected mapTag(tag: never): Tag {
    return tagFromModel(tag);
  }

  /** A commit as a listing serves it. */
  protected mapCommitSummary(commit: never): CommitSummary {
    return commitSummaryFromModel(commit);
  }

  protected mapCiRun(run: never): CiRun {
    return ciRunFromModel(run);
  }

  /** `runId` names the run the jobs were listed for, where the forge leaves it off a job. */
  protected mapCiJob(job: never, runId: string): CiJob {
    return ciJobFromModel(job, runId);
  }

  /** Keyed by endpoint and token. No token, no credential to aim, so the key needn't be secret. */
  protected override cursorKey(): Uint8Array {
    return this.#cursorKey;
  }

  /** A base URL that does not parse fails on the first request, where forges opens it. */
  protected override cursorOrigin(): string | undefined {
    return URL.parse(this.#apiBaseURL)?.origin;
  }

  /** One `forges` call; a refusal gated on an unknown version reads it once and retries. */
  protected async forgeCall<T>(run: (forge: Forge) => Promise<T>): Promise<T> {
    const forge = await this.#open();
    const known = this.#refreshDone;
    try {
      return await run(forge);
    } catch (error) {
      if (!isUnsupported(error) || known) throw this.#failure(error);
      this.#refreshed ??= forge
        .refreshCapabilities()
        .catch(() => undefined)
        .finally(() => {
          this.#refreshDone = true;
        });
      await this.#refreshed;
      try {
        return await run(forge);
      } catch (retried) {
        throw this.#failure(retried);
      }
    }
  }

  /** A verb the forge lacks is a 501, and without a token that may be the reason. */
  #failure(error: unknown): ForgesError {
    if (isUnsupported(error)) {
      const reason =
        this.#token === ""
          ? `${(error as Error).message} without a token; pass one if this forge serves it to signed-in accounts only`
          : (error as Error).message;
      return new ForgesError(reason, {
        status: 501,
        platform: this.#platform,
        originalError: error as Error,
      });
    }
    return normalizeError(toFetchError(error), this.#platform);
  }

  #open(): Promise<Forge> {
    this.#forge ??= Promise.resolve()
      .then(() =>
        this.createForge({
          baseUrl: this.#apiBaseURL,
          auth: this.#token === "" ? { type: "anonymous" } : { type: "token", token: this.#token },
          userAgent: `forges/${version}`,
          fetch: forgeFetch,
        }),
      )
      .catch((error: unknown) => {
        this.#forge = undefined;
        throw this.#failure(error);
      });
    return this.#forge;
  }

  /** Names stay one path segment: a forge decoding `%2F` would route `../admin` elsewhere. */
  protected repoRef(forge: Forge, { owner, repo }: RepoRef): ForgeRepoRef {
    this.assertRepositoryPath(owner, repo);
    return { forge: forge.forge, instance: forge.instance, owner, name: repo };
  }

  protected assertRepositoryPath(owner: string, repo: string): void {
    this.assertOwnerPath(owner);
    encodePathSegment(repo, "Repository name");
  }

  /** One segment; GitLab lets the owner be a nested group. */
  protected assertOwnerPath(owner: string): void {
    encodePathSegment(owner, "Owner");
  }

  /** Page options `forges` takes for a position this provider handed out, 30 rows by default. */
  protected forgePageOptions(options: { perPage?: number; at?: PagePosition } | undefined) {
    const at = options?.at;
    const page: ForgePageOptions = { perPage: options?.perPage ?? DEFAULT_PER_PAGE };
    if (at === undefined) return page;
    if ("url" in at) page.cursor = { nextUrl: at.url };
    else if ("token" in at) page.cursor = { token: at.token };
    else
      throw new ForgesError("cursor is not one this listing returned", {
        status: 400,
        platform: this.#platform,
      });
    return page;
  }

  /** One page of a listing, mapped, with where the next one starts. */
  protected async forgePage<T, U>(
    listing: ForgeListing<T>,
    map: (item: T) => U,
  ): Promise<ContinuedPage<U>> {
    return continuedPage(await listing.page(), { map, origin: this.cursorOrigin() });
  }

  protected override async getRepo(repo: RepoRef): Promise<Repository> {
    return this.forgeCall(async (forge) =>
      this.mapRepository(
        this.forgePayload(await forge.repos.get(this.repoRef(forge, repo))) as never,
      ),
    );
  }

  protected override async getUser(username: string): Promise<User> {
    encodePathSegment(username, "Username");
    return this.forgeCall(async (forge) =>
      this.mapUser(this.forgePayload(await forge.users.get(username)) as never),
    );
  }

  protected override async getAuthenticatedUser(): Promise<User> {
    return this.forgeCall(async (forge) =>
      this.mapUser(this.forgePayload(await forge.users.me()) as never),
    );
  }

  protected override listReleases(
    repo: RepoRef,
    options?: Positioned<ListReleasesOptions>,
  ): Promise<ContinuedPage<Release>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.releases.list(this.repoRef(forge, repo), this.forgePageOptions(options)),
        (release) => this.mapRelease(this.forgePayload(release) as never),
      ),
    );
  }

  protected override getRelease(repo: RepoRef, { tag }: { tag: string }): Promise<Release> {
    encodeRefPathSegment(tag, "Tag");
    return this.forgeCall(async (forge) =>
      this.mapRelease(
        this.forgePayload(await forge.releases.getByTag(this.repoRef(forge, repo), tag)) as never,
      ),
    );
  }

  protected override createRelease(repo: RepoRef, input: CreateReleaseInput): Promise<Release> {
    return this.forgeCall(async (forge) =>
      this.mapRelease(
        this.forgePayload(
          await forge.releases.create(this.repoRef(forge, repo), {
            ...releaseUpdate(input),
            tag: input.tag,
            ...(input.ref === undefined ? {} : { target: input.ref }),
          }),
        ) as never,
      ),
    );
  }

  protected override updateRelease(
    repo: RepoRef,
    { tag, ...input }: UpdateReleaseInput & { tag: string },
  ): Promise<Release> {
    encodeRefPathSegment(tag, "Tag");
    return this.forgeCall(async (forge) => {
      const ref = await this.releaseRef(forge, { ...repo, tag });
      return this.mapRelease(
        this.forgePayload(await forge.releases.update(ref, releaseUpdate(input))) as never,
      );
    });
  }

  /** The release behind a tag; forges that edit a release by id need it read first. */
  protected async releaseRef(forge: Forge, release: ReleaseTag): Promise<ReleaseRef> {
    return (await forge.releases.getByTag(this.repoRef(forge, release), release.tag)).ref;
  }

  protected override listTags(
    repo: RepoRef,
    options?: Positioned<ListTagsOptions>,
  ): Promise<ContinuedPage<Tag>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.contents.tags(this.repoRef(forge, repo), this.forgePageOptions(options)),
        (tag) => this.mapTag(this.forgePayload(tag) as never),
      ),
    );
  }

  protected override listCommits(
    repo: RepoRef,
    options?: Positioned<ListCommitOptions>,
  ): Promise<ContinuedPage<CommitSummary>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.commits.list(this.repoRef(forge, repo), {
          ...this.forgePageOptions(options),
          ...(options?.ref ? { ref: options.ref } : {}),
          ...(options?.path ? { path: options.path } : {}),
          ...(options?.since ? { since: this.#date(options.since, "since") } : {}),
          ...(options?.until ? { until: this.#date(options.until, "until") } : {}),
        }),
        (commit) => this.mapCommitSummary(this.forgePayload(commit) as never),
      ),
    );
  }

  protected override listCiRuns(
    repo: RepoRef,
    options?: Positioned<ListCiRunsOptions>,
  ): Promise<ContinuedPage<CiRun>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.ci.runs(this.repoRef(forge, repo), {
          ...this.forgePageOptions(options),
          ...(options?.branch ? { branch: options.branch } : {}),
        }),
        (run) => this.mapCiRun(this.forgePayload(run) as never),
      ),
    );
  }

  protected override listCiJobs(
    repo: RepoRef,
    { runId, ...options }: Positioned<ListCiJobsOptions> & { runId: string },
  ): Promise<ContinuedPage<CiJob>> {
    return this.forgeCall((forge) => {
      const ref = this.repoRef(forge, repo);
      return this.forgePage(
        forge.ci.jobs(
          { forge: forge.forge, instance: forge.instance, repo: ref, id: runId },
          this.forgePageOptions(options),
        ),
        (job) => this.mapCiJob(this.forgePayload(job) as never, runId),
      );
    });
  }

  /** `forges` takes dates, and a string that isn't one is the caller's to fix. */
  #date(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new ForgesError(`${field} must be an ISO 8601 date`, {
        status: 400,
        platform: this.#platform,
      });
    }
    return date;
  }

  /** `forges` drops the pull requests GitHub's issues route serves alongside issues. */
  protected override listIssues(
    repo: RepoRef,
    options?: Positioned<ListOptions>,
  ): Promise<ContinuedPage<Issue>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.threads.list(this.repoRef(forge, repo), {
          ...this.forgePageOptions(options),
          kind: "issue",
          state: options?.state ?? "open",
        }),
        (thread) => this.mapIssue(this.forgePayload(thread) as never),
      ),
    );
  }

  protected override listIssueComments(
    issue: IssueRef,
    options?: Positioned<ListCommentOptions>,
  ): Promise<ContinuedPage<Comment>> {
    return this.#listComments({ ...issue, kind: "issue" }, options);
  }

  protected override listPullRequestComments(
    pull: IssueRef,
    options?: Positioned<ListCommentOptions>,
  ): Promise<ContinuedPage<Comment>> {
    return this.#listComments({ ...pull, kind: "pull_request" }, options);
  }

  #listComments(
    thread: KindedThread,
    options?: Positioned<ListCommentOptions>,
  ): Promise<ContinuedPage<Comment>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.threads.comments(this.threadRef(forge, thread), this.forgePageOptions(options)),
        (comment) => this.mapComment(this.forgePayload(comment) as never),
      ),
    );
  }

  /** Files carry no forge payload in `forges`, so its model maps them; counts it lacks are null. */
  protected override listPullRequestFiles(
    pull: IssueRef,
    options?: Positioned<ListPullRequestFilesOptions>,
  ): Promise<ContinuedPage<PullRequestFile>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.threads.files(
          this.threadRef(forge, { ...pull, kind: "pull_request" }),
          this.forgePageOptions(options),
        ),
        changedFileFromModel,
      ),
    );
  }

  protected override getCommit(repo: RepoRef, { sha }: { sha: string }): Promise<Commit> {
    encodePathSegment(sha, "Commit SHA");
    return this.forgeCall(async (forge) =>
      commitFromModel(
        await forge.commits.get({
          forge: forge.forge,
          instance: forge.instance,
          repo: this.repoRef(forge, repo),
          sha,
        }),
      ),
    );
  }

  /** `forges` reads checks by commit sha, so a branch or tag is resolved first. */
  protected override listCommitChecks(
    repo: RepoRef,
    { ref, ...options }: WithPage<ListCommitChecksOptions> & { ref: string },
  ): Promise<NumberedPage<PullRequestCheck>> {
    return this.forgeCall(async (forge) => {
      const repoRef = this.repoRef(forge, repo);
      const sha = await forge.contents.resolveRef(repoRef, ref);
      const checks = await forge.checks.list(repoRef, sha);
      return slicePage(checks.items.map(checkFromModel), options);
    });
  }

  protected override getIssue(issue: IssueRef): Promise<Issue> {
    return this.forgeCall(async (forge) =>
      this.mapIssue(
        this.forgePayload(
          await this.#readThread(forge, this.threadRef(forge, { ...issue, kind: "issue" })),
        ) as never,
      ),
    );
  }

  protected override createIssue(repo: RepoRef, input: CreateIssueInput): Promise<Issue> {
    return this.forgeCall(async (forge) =>
      this.mapIssue(
        this.forgePayload(
          await forge.threads.create(this.repoRef(forge, repo), {
            kind: "issue",
            title: input.title,
            body: input.body,
            ...(input.labels === undefined ? {} : { labels: input.labels }),
            ...(input.assignees === undefined ? {} : { assignees: input.assignees }),
          }),
        ) as never,
      ),
    );
  }

  /** Continues by the forge's own cursor, like the issue listing. */
  protected override listPullRequests(
    repo: RepoRef,
    options?: Positioned<ListOptions>,
  ): Promise<ContinuedPage<PullRequest>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.threads.list(this.repoRef(forge, repo), {
          ...this.forgePageOptions(options),
          kind: "pull_request",
          state: options?.state ?? "open",
        }),
        (thread) => this.mapPullRequest(this.forgePayload(thread) as never),
      ),
    );
  }

  protected override getPullRequest(pull: IssueRef): Promise<PullRequest> {
    return this.forgeCall(async (forge) =>
      this.mapPullRequest(
        this.forgePayload(
          await this.#readThread(forge, this.threadRef(forge, { ...pull, kind: "pull_request" })),
        ) as never,
      ),
    );
  }

  protected override createPullRequest(
    repo: RepoRef,
    input: CreatePullRequestInput,
  ): Promise<PullRequest> {
    return this.forgeCall(async (forge) =>
      this.mapPullRequest(
        this.forgePayload(
          await forge.threads.create(this.repoRef(forge, repo), {
            kind: "pull_request",
            title: input.title,
            body: input.body,
            head: input.sourceBranch,
            base: input.targetBranch,
            ...(input.draft === undefined ? {} : { draft: input.draft }),
            ...(input.assignees === undefined ? {} : { assignees: input.assignees }),
          }),
        ) as never,
      ),
    );
  }

  protected override listPullRequestChecks(
    pull: IssueRef,
    options?: WithPage<ListPullRequestChecksOptions>,
  ): Promise<NumberedPage<PullRequestCheck>> {
    return this.forgeCall(async (forge) => {
      const checks = await forge.threads.checks(
        this.threadRef(forge, { ...pull, kind: "pull_request" }),
      );
      return slicePage(checks.items.map(checkFromModel), options);
    });
  }

  protected override getIssueComment(
    issue: IssueRef,
    { commentId }: { commentId: string },
  ): Promise<Comment> {
    return this.#findComment({ ...issue, kind: "issue" }, commentId);
  }

  protected override getPullRequestComment(
    pull: IssueRef,
    { commentId }: { commentId: string },
  ): Promise<Comment> {
    return this.#findComment({ ...pull, kind: "pull_request" }, commentId);
  }

  /** Searched in the thread's own comments: some forges read one by id alone, from any thread. */
  #findComment(thread: KindedThread, commentId: string): Promise<Comment> {
    return this.forgeCall(async (forge) => {
      const ref = this.threadRef(forge, thread);
      await this.#readThread(forge, ref);
      for await (const comment of forge.threads.comments(ref, { perPage: 100 })) {
        if (comment.ref.id === commentId) {
          return this.mapComment(this.forgePayload(comment) as never);
        }
      }
      throw new NotFoundError(`Comment not found: ${commentId}`, { platform: this.#platform });
    });
  }

  /** The number of an issue read as a pull request, or the other way round, is not found. */
  async #readThread(forge: Forge, ref: ThreadRef): Promise<ForgeThread> {
    const thread = await forge.threads.get(ref);
    if (thread.kind !== ref.kind) {
      const kind = ref.kind === "issue" ? "Issue" : "Pull request";
      throw new NotFoundError(`${kind} not found: ${ref.number}`, { platform: this.#platform });
    }
    return thread;
  }

  protected override listThreads(
    pull: IssueRef,
    options?: WithPage<ListThreadOptions>,
  ): Promise<NumberedPage<Thread>> {
    return this.forgeCall(async (forge) => {
      const conversations = await this.#conversations(forge, pull);
      const threads = conversations.map(threadFromModel);
      return slicePage(this.filterThreadsByState(threads, options?.state), options);
    });
  }

  protected override getThread(
    pull: IssueRef,
    { threadId }: { threadId: string },
  ): Promise<Thread> {
    return this.forgeCall(async (forge) =>
      threadFromModel(await this.#conversation(forge, { ...pull, threadId })),
    );
  }

  /** The reply goes to the comment that opened the conversation. */
  protected override replyToThread(
    pull: IssueRef,
    { threadId, body }: ReplyThreadInput & { threadId: string },
  ): Promise<ThreadComment> {
    return this.forgeCall(async (forge) => {
      const conversation = await this.#conversation(forge, { ...pull, threadId });
      const [opening] = conversation.comments;
      if (opening === undefined)
        throw new NotFoundError(`Thread not found: ${threadId}`, { platform: this.#platform });
      const reply = await forge.threads.replyToReviewComment(
        this.threadRef(forge, { ...pull, kind: "pull_request" }),
        opening,
        body,
      );
      return threadCommentFromModel(reply);
    });
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

  /** The conversation is read first, so an id from another pull request is not found here. */
  #setResolved(
    pull: IssueRef,
    change: Readonly<{ threadId: string; resolved: boolean }>,
  ): Promise<Thread> {
    return this.forgeCall(async (forge) => {
      const conversation = await this.#conversation(forge, { ...pull, threadId: change.threadId });
      const ref = this.threadRef(forge, { ...pull, kind: "pull_request" });
      await (change.resolved
        ? forge.threads.resolveReviewThread(ref, conversation.id)
        : forge.threads.unresolveReviewThread(ref, conversation.id));
      return threadFromModel({ ...conversation, resolved: change.resolved });
    });
  }

  async #conversation(
    forge: Forge,
    { threadId, ...pull }: Readonly<IssueRef & { threadId: string }>,
  ): Promise<ReviewConversation> {
    const conversation = (await this.#conversations(forge, pull)).find(
      (candidate) => candidate.id === threadId,
    );
    if (conversation === undefined) {
      throw new NotFoundError(`Thread not found: ${threadId}`, { platform: this.#platform });
    }
    return conversation;
  }

  /** An issue number fails the kind check first, whichever read gives up sooner. */
  async #conversations(forge: Forge, pull: IssueRef): Promise<ReviewConversation[]> {
    const ref = this.threadRef(forge, { ...pull, kind: "pull_request" });
    const [thread, conversations] = await Promise.allSettled([
      this.#readThread(forge, ref),
      this.#readConversations(forge, ref),
    ]);
    if (thread.status === "rejected") throw thread.reason;
    if (conversations.status === "rejected") throw conversations.reason;
    return conversations.value;
  }

  /** The forge's own conversations where it has them; elsewhere every review is read, as a reply can land in a later one. */
  async #readConversations(forge: Forge, ref: ThreadRef): Promise<ReviewConversation[]> {
    const support = forge.capabilities.threads.reviewThreads;
    if (support === true || support === "emulated") {
      return Array.fromAsync(forge.threads.reviewThreads(ref, { perPage: 100 }));
    }
    return reviewConversations(await Array.fromAsync(forge.threads.reviews(ref, { perPage: 100 })));
  }

  protected threadRef(forge: Forge, thread: KindedThread): ThreadRef {
    return {
      forge: forge.forge,
      instance: forge.instance,
      repo: this.repoRef(forge, thread),
      kind: thread.kind,
      number: String(thread.number),
    };
  }

  /** `forges` tells a namespace ref by `kind` alone; an empty name would still read as a repo. */
  protected override listRepos(
    owner: string,
    options?: Positioned<ListOptions>,
  ): Promise<ContinuedPage<Repository>> {
    this.assertOwnerPath(owner);
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.repos.byOwner(
          { forge: forge.forge, instance: forge.instance, owner, name: "", kind: "namespace" },
          this.forgePageOptions(options),
        ),
        (repo) => this.mapRepository(this.forgePayload(repo) as never),
      ),
    );
  }
}

/** The release fields a caller set, leaving out the ones it did not. */
export function releaseUpdate(input: UpdateReleaseInput) {
  return Object.fromEntries(
    (["name", "body", "draft", "prerelease"] as const)
      .filter((field) => input[field] !== undefined)
      .map((field) => [field, input[field]]),
  ) as Pick<UpdateReleaseInput, "name" | "body" | "draft" | "prerelease">;
}

/** Maps a `forges` page and carries its continuation as a position. */
export function continuedPage<T, U>(
  page: Page<T>,
  { map, origin }: Readonly<{ map: (item: T) => U; origin?: string }>,
): ContinuedPage<U> {
  const next = positionOf(page.cursor, origin);
  return {
    items: page.items.map(map),
    ...(page.total === undefined ? {} : { totalCount: page.total }),
    ...(next === undefined ? {} : { next }),
  };
}

/** A relative next link, which Gitea sends as a path, resolves on the API origin. */
function positionOf(cursor: Cursor | undefined, origin?: string): PagePosition | undefined {
  if (cursor?.nextUrl) {
    const url =
      URL.canParse(cursor.nextUrl) || origin === undefined
        ? cursor.nextUrl
        : new URL(cursor.nextUrl, origin).toString();
    return { url };
  }
  if (cursor?.token) return { token: cursor.token };
  return undefined;
}

function isUnsupported(error: unknown): boolean {
  return error instanceof Error && error.name === "UnsupportedOperationError";
}

/** A tag as GitHub and Gitea send it, naming the commit it peels to. */
export interface CommitTag {
  name: string;
  commit?: { sha?: string };
}

/** GitHub and Gitea name the peeled commit on each tag; a tag on a tree or blob names none. */
export function commitTag(raw: CommitTag): Tag {
  return { name: raw.name, sha: raw.commit?.sha || null };
}

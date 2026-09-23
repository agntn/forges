/**
 * Core contracts for the unified abstract git provider API.
 * Normalizes across GitHub, GitLab, Gitea, and GitBucket APIs.
 */

/**
 * User information
 */
export interface User {
  id: string;
  login: string;
  name: string;
  email: string;
  avatarUrl: string;
  isAdmin: boolean;
  bio: string;
  company: string;
  location: string;
  website: string;
  followers: number;
  following: number;
  createdAt: string;
  url: string;
}

/**
 * Repository owner information
 */
export interface Owner {
  login: string;
  avatarUrl: string;
}

/** A repository's immediate upstream when it is a fork. */
export interface RepositoryParent {
  fullName: string;
  url: string;
}

/** The authenticated viewer's highest repository role, or `null` when the API omits it. */
export type RepositoryPermission = "none" | "read" | "triage" | "write" | "maintain" | "admin";

/**
 * Repository information
 */
export interface Repository {
  id: string;
  name: string;
  fullName: string;
  description: string;
  private: boolean;
  defaultBranch: string;
  url: string;
  cloneUrl: string;
  isFork: boolean;
  /** Null when the repository has no upstream or the platform hides it. */
  parent: RepositoryParent | null;
  /** Null when the platform omits access metadata for the current viewer. */
  viewerPermission: RepositoryPermission | null;
  owner: Owner;
}

/** Contribution workflow that a repository template belongs to. */
export type ContributionTemplateKind = "issue" | "pull_request";

/**
 * Scope that supplied the effective template. Group and instance are available
 * to providers that expose those origins; use unknown when the API hides them.
 */
export type ContributionTemplateScope = "repository" | "owner" | "group" | "instance" | "unknown";

/**
 * One effective contribution template without its potentially large body.
 * The provider-issued key is opaque and must be passed back unchanged to `get`.
 */
export interface ContributionTemplateSummary {
  kind: ContributionTemplateKind;
  key: string;
  name: string;
  /** Repository-local, owner-level, or another platform inheritance scope. */
  scope: ContributionTemplateScope;
  inherited: boolean;
  /** Repository holding the winning file, or null when the platform hides it. */
  sourceRepository: string | null;
  /** Repository-relative path of the winning file, or null when the platform hides it. */
  sourcePath: string | null;
  /** Ref used to read the winning file, or null when the platform hides it. */
  sourceRef: string | null;
}

/** One effective contribution template with its complete source body. */
export interface ContributionTemplate extends ContributionTemplateSummary {
  content: string;
}

/** Pagination for one contribution-template kind. */
export interface ListContributionTemplatesOptions {
  page?: number;
  perPage?: number;
}

/** Provider-independent lifecycle state of a CI run. */
export type CiRunStatus = "queued" | "in_progress" | "waiting" | "completed";

/** Provider-independent terminal outcome, or null while no outcome exists. */
export type CiRunConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "neutral"
  | "timed_out"
  | "action_required"
  | "stale"
  | "startup_failure"
  | null;

/** One GitHub Actions run, GitLab pipeline, or Gitea Actions run. */
export interface CiRun {
  id: string;
  branch: string;
  revision: string;
  status: CiRunStatus;
  conclusion: CiRunConclusion;
  url: string;
}

/** One step of a CI job. Times are ISO 8601, null when the step never ran. */
export interface CiJobStep {
  number: number;
  name: string;
  status: CiRunStatus;
  conclusion: CiRunConclusion;
  startedAt: string | null;
  completedAt: string | null;
}

/** One job of a CI run. GitLab reports no steps, so its steps are empty. */
export interface CiJob {
  id: string;
  runId: string;
  name: string;
  status: CiRunStatus;
  conclusion: CiRunConclusion;
  startedAt: string | null;
  completedAt: string | null;
  url: string;
  steps: CiJobStep[];
}

/** Pagination for the jobs of one CI run. */
export interface ListCiJobsOptions {
  page?: number;
  perPage?: number;
}

/** Continuation and output bounds for a job log read. */
export interface CiJobLogOptions {
  offset?: number;
  maxChars?: number;
}

/**
 * One bounded slice of a job log. Timestamps and ANSI escapes are removed; on
 * GitHub and Gitea each step is a `--- step N name: conclusion` section, failing
 * steps first. `started` is false when no runner took the job, so it has no log.
 * `logComplete` is false when the log was longer than the read keeps and only
 * its end is here. Continue with jobId and nextOffset.
 */
export interface CiJobLog {
  jobId: string;
  name: string;
  status: CiRunStatus;
  conclusion: CiRunConclusion;
  started: boolean;
  logComplete: boolean;
  content: string;
  offset: number;
  nextOffset: number | null;
  truncated: boolean;
  length: number;
}

/** A normalized check or pipeline associated with a pull request head revision. */
export interface PullRequestCheck {
  id: string;
  name: string;
  status: CiRunStatus;
  conclusion: CiRunConclusion;
  url: string;
}

/**
 * Issue state
 */
export type IssueState = "open" | "closed";

/**
 * Issue information
 */
export interface Issue {
  id: string;
  number: number;
  title: string;
  body: string;
  state: IssueState;
  labels: string[];
  author: {
    login: string;
  };
  assignees: Array<{ login: string }>;
  createdAt: string;
  updatedAt: string;
  url: string;
}

/** Pull-request fields available directly from every provider's search response. */
export interface PullRequestSearchItem extends Issue {
  merged: boolean;
  draft: boolean;
}

/** A search hit keeps the repository needed to open the pull request. */
export interface GlobalPullRequestSearchItem extends PullRequestSearchItem {
  repository: string;
}

/** Native query scope, ordering and pagination for search across repositories. */
export interface GlobalPullRequestSearchOptions {
  owner?: string;
  repo?: string;
  page?: number;
  perPage?: number;
  sort?: "created" | "updated" | "comments";
  order?: "asc" | "desc";
}

/** Search can match more pull requests than the provider exposes. */
export interface GlobalPullRequestSearchResult extends SearchPageResult<GlobalPullRequestSearchItem> {
  resultLimit: number;
}

/** Pull request information. */
export interface PullRequest extends PullRequestSearchItem {
  sourceBranch: string;
  targetBranch: string;
  mergeCommitSha: string;
  /** When the pull request was merged; null until it is. */
  mergedAt: string | null;
  /** Who merged it; null until merged, or when the provider's response leaves it out. */
  mergedBy: { login: string } | null;
  headSha: string;
  mergeable: boolean | null;
  mergeStatus: string;
  /**
   * Issues the pull request closes when merged. Present only when the read asks for
   * it with `closingIssues`; null when the provider cannot report them, so unknown
   * never reads as none.
   */
  closingIssues?: ClosingIssue[] | null;
}

/** An issue a pull request closes on merge; it may live in another repository. */
export interface ClosingIssue {
  number: number;
  title: string;
  state: IssueState;
  url: string;
}

/** Extra data a single pull-request read may fetch. */
export interface GetPullRequestOptions {
  /** Also fetch the issues the pull request closes, at the cost of one more request. */
  closingIssues?: boolean;
}

/** Normalized status of one changed file. */
export type ChangedFileStatus = "added" | "modified" | "removed" | "renamed" | "copied" | "unknown";

/** One changed file. Counts are null when the provider does not report them. */
export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  additions: number | null;
  deletions: number | null;
}

/** Changed-file status exposed by pull-request reads. */
export type PullRequestFileStatus = ChangedFileStatus;

/** Changed file exposed by pull-request reads. */
export interface PullRequestFile extends ChangedFile {}

/** Verdict of one pull-request review. */
export type PullRequestReviewState =
  | "approved"
  | "changes_requested"
  | "commented"
  | "dismissed"
  | "pending";

/** One review on a pull request. On GitLab one reviewer's stance, its id that user's id. */
export interface PullRequestReview {
  id: string;
  state: PullRequestReviewState;
  body: string;
  author: {
    login: string;
  };
  /** Commit the review was given against, or empty when the platform records none. */
  revision: string;
  /** When the review was given, or empty when the platform records no time. */
  submittedAt: string;
  url: string;
}

/** One commit author or committer identity from git metadata. */
export interface CommitIdentity {
  name: string;
  email: string;
  date: string;
}

/** One commit summary without changed-file rows. */
export interface CommitSummary {
  sha: string;
  message: string;
  author: CommitIdentity;
  committer: CommitIdentity;
  parents: string[];
  url: string;
}

/** A commit search hit identifies its repository so it can be opened with commits.get. */
export interface CommitSearchItem extends CommitSummary {
  repository: string;
}

/** Native commit query scope and pagination. Date qualifiers stay in the query. */
export interface CommitSearchOptions {
  owner?: string;
  repo?: string;
  page?: number;
  perPage?: number;
}

/** Search may match more commits than the provider allows callers to retrieve. */
export interface CommitSearchResult extends SearchPageResult<CommitSearchItem> {
  resultLimit: number;
}

/** One commit with normalized metadata and changed-file rows. filesComplete is null when provider or safety limits prevent certainty. */
export interface Commit extends CommitSummary {
  files: ChangedFile[];
  filesComplete: boolean | null;
}

/** Availability of one provider patch. */
export type CommitPatchState = "included" | "binary" | "unavailable";

/** Provider patch material before it is rendered into a bounded stream. */
export interface CommitPatchFile {
  path: string;
  previousPath: string | null;
  status: ChangedFileStatus;
  state: CommitPatchState;
  patch: string;
}

/** Selection and continuation options for a commit patch read. */
export interface CommitPatchOptions {
  path?: string;
  offset?: number;
  maxChars?: number;
}

/** One bounded slice. Continue with sha, nextOffset, and the same non-null path. */
export interface CommitPatch {
  sha: string;
  path: string | null;
  content: string;
  offset: number;
  nextOffset: number | null;
  truncated: boolean;
  filesComplete: boolean | null;
  states: Record<CommitPatchState, number>;
}

/** Kind of one entry in a repository tree. */
export type RepositoryEntryType = "file" | "directory" | "symlink" | "submodule";

/** One entry of a repository directory. size is null when the platform leaves it out. */
export interface RepositoryEntry {
  name: string;
  path: string;
  type: RepositoryEntryType;
  size: number | null;
}

/** Revision and continuation options for a repository contents read. */
export interface RepositoryContentsOptions {
  /** Branch, tag or commit. Defaults to the default branch. */
  ref?: string;
  offset?: number;
  maxChars?: number;
}

/** One bounded slice of a file. Continue with sha and nextOffset. */
export interface RepositoryFileContents {
  type: "file";
  path: string;
  /** Commit the read resolved ref to. */
  sha: string;
  /** Size in bytes. */
  size: number;
  /** True when the bytes are not UTF-8 text; content is then empty. */
  binary: boolean;
  content: string;
  offset: number;
  nextOffset: number | null;
  truncated: boolean;
}

/** One directory listing. entriesComplete is null when the platform caps the listing. */
export interface RepositoryDirectoryContents {
  type: "directory";
  path: string;
  /** Commit the read resolved ref to. */
  sha: string;
  entries: RepositoryEntry[];
  entriesComplete: boolean | null;
}

/** What one path of a repository holds at a commit. */
export type RepositoryContents = RepositoryFileContents | RepositoryDirectoryContents;

/** One release: a tag with notes. Keyed by tag everywhere, because GitLab releases have no id. */
export interface Release {
  /** Platform id, or the tag name on GitLab. */
  id: string;
  tag: string;
  name: string;
  body: string;
  /** GitLab has no drafts, so always false there. */
  draft: boolean;
  /** GitLab has no pre-releases, so always false there. */
  prerelease: boolean;
  author: {
    login: string;
  };
  createdAt: string;
  /** Empty for a GitHub draft, which has no publication yet. */
  publishedAt: string;
  url: string;
}

/** List options for repository releases. */
export interface ListReleasesOptions {
  page?: number;
  perPage?: number;
}

/** Input for creating a release. */
export interface CreateReleaseInput {
  tag: string;
  name?: string;
  body?: string;
  /** Branch or commit to tag when the tag does not exist yet. */
  ref?: string;
  /** GitLab has no drafts and rejects true. */
  draft?: boolean;
  /** GitLab has no pre-releases and rejects true. */
  prerelease?: boolean;
}

/** Input for updating a release. Omitted fields keep their value. */
export interface UpdateReleaseInput {
  name?: string;
  body?: string;
  /** GitLab has no drafts and rejects true. */
  draft?: boolean;
  /** GitLab has no pre-releases and rejects true. */
  prerelease?: boolean;
}

/**
 * Paginated result wrapper
 */
export interface PageResult<T> {
  items: T[];
  totalCount?: number;
  hasNextPage: boolean;
  nextPage?: number;
}

/** Paginated search results, including whether the response is known to be partial. */
export interface SearchPageResult<T> extends PageResult<T> {
  incomplete: boolean;
}

/** One normalized file match from repository code search. */
export interface CodeSearchItem {
  repository: string;
  path: string;
  url: string;
}

/** Pagination and optional repository scope for code search. */
export interface CodeSearchOptions {
  owner?: string;
  repo?: string;
  page?: number;
  perPage?: number;
}

/**
 * List operation options
 */
export interface ListOptions {
  page?: number;
  perPage?: number;
  state?: IssueState | "all";
}

/** List options for repository CI runs. */
export interface ListCiRunsOptions {
  page?: number;
  perPage?: number;
  branch?: string;
}

/** List options for repository commits. */
export interface ListCommitOptions {
  page?: number;
  perPage?: number;
  ref?: string;
  path?: string;
  since?: string;
  until?: string;
}

/**
 * Input for creating an issue
 */
export interface CreateIssueInput {
  title: string;
  body: string;
  labels?: string[];
  /** Assignee logins. GitLab Free accepts only one. */
  assignees?: string[];
}

/**
 * Input for creating a pull request
 */
export interface CreatePullRequestInput {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  draft?: boolean;
  /** Assignee logins. GitLab Free accepts only one. */
  assignees?: string[];
}

/**
 * Input for updating a pull request. Omitted fields keep their value, and the
 * assignee and label lists change by the logins and names given, so the ones
 * already there stay unless they are removed.
 */
export interface UpdatePullRequestInput {
  title?: string;
  body?: string;
  /** Closes or reopens it. A merged pull request stays merged. */
  state?: IssueState;
  /** GitLab Free keeps one assignee. */
  addAssignees?: string[];
  removeAssignees?: string[];
  /** Gitea rejects a label that neither the repository nor its organization has. */
  addLabels?: string[];
  removeLabels?: string[];
}

/**
 * One comment in an issue or pull-request discussion
 */
export interface Comment {
  id: string;
  body: string;
  author: {
    login: string;
  };
  url: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * List operation options for discussion comments
 */
export interface ListCommentOptions {
  page?: number;
  perPage?: number;
}

/**
 * Input for a new comment in an issue or pull-request discussion
 */
export interface CreateCommentInput {
  body: string;
}

/** List operation options for pull-request files. */
export interface ListPullRequestFilesOptions {
  page?: number;
  perPage?: number;
}

/** List operation options for pull-request checks. */
export interface ListPullRequestChecksOptions {
  page?: number;
  perPage?: number;
}

/** List operation options for pull-request reviews. */
export interface ListPullRequestReviewsOptions {
  page?: number;
  perPage?: number;
}

/**
 * Review-thread state filter
 */
export type ThreadState = "unresolved" | "resolved" | "all";

/**
 * One comment inside a review thread
 */
export interface ThreadComment {
  id: string;
  body: string;
  author: {
    login: string;
  };
  url: string;
  createdAt: string;
}

/**
 * Pull-request review thread
 */
export interface Thread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  comments: ThreadComment[];
}

/**
 * List operation options for review threads
 */
export interface ListThreadOptions {
  page?: number;
  perPage?: number;
  state?: ThreadState;
}

/**
 * Input for replying inside an existing review thread
 */
export interface ReplyThreadInput {
  body: string;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  baseURL?: string;
  token?: string;
  cache?: {
    enabled?: boolean;
    ttl?: number;
    prefix?: string;
  };
  gitlab?: {
    projectIdCacheMax?: number;
    projectIdCacheTtl?: number;
  };
}

/**
 * Resource accessor for repositories
 */
export interface RepositoryResource {
  list(owner: string, options?: ListOptions): Promise<PageResult<Repository>>;
  get(owner: string, repo: string): Promise<Repository>;
  readContents(
    owner: string,
    repo: string,
    path: string,
    options?: RepositoryContentsOptions,
  ): Promise<RepositoryContents>;
}

/** Resource accessor for effective repository contribution templates. */
export interface ContributionTemplateResource {
  list(
    owner: string,
    repo: string,
    kind: ContributionTemplateKind,
    options?: ListContributionTemplatesOptions,
  ): Promise<PageResult<ContributionTemplateSummary>>;
  get(
    owner: string,
    repo: string,
    kind: ContributionTemplateKind,
    key: string,
  ): Promise<ContributionTemplate>;
}

/** Resource accessor for repository code search. */
export interface CodeSearchResource {
  search(query: string, options?: CodeSearchOptions): Promise<SearchPageResult<CodeSearchItem>>;
}

/** Resource accessor for repository CI runs. */
export interface CiRunResource {
  list(owner: string, repo: string, options?: ListCiRunsOptions): Promise<PageResult<CiRun>>;
  listJobs(
    owner: string,
    repo: string,
    runId: string,
    options?: ListCiJobsOptions,
  ): Promise<PageResult<CiJob>>;
  readJobLog(
    owner: string,
    repo: string,
    jobId: string,
    options?: CiJobLogOptions,
  ): Promise<CiJobLog>;
}

/** Resource accessor for commits. */
export interface CommitResource {
  search(query: string, options?: CommitSearchOptions): Promise<CommitSearchResult>;
  list(
    owner: string,
    repo: string,
    options?: ListCommitOptions,
  ): Promise<PageResult<CommitSummary>>;
  get(owner: string, repo: string, sha: string): Promise<Commit>;
  readPatch(
    owner: string,
    repo: string,
    sha: string,
    options?: CommitPatchOptions,
  ): Promise<CommitPatch>;
}

/** Resource accessor for releases. */
export interface ReleaseResource {
  list(owner: string, repo: string, options?: ListReleasesOptions): Promise<PageResult<Release>>;
  get(owner: string, repo: string, tag: string): Promise<Release>;
  create(owner: string, repo: string, input: CreateReleaseInput): Promise<Release>;
  update(owner: string, repo: string, tag: string, input: UpdateReleaseInput): Promise<Release>;
}

/**
 * Resource accessor for issues
 */
export interface IssueResource {
  list(owner: string, repo: string, options?: ListOptions): Promise<PageResult<Issue>>;
  search(
    owner: string,
    repo: string,
    query: string,
    options?: ListOptions,
  ): Promise<SearchPageResult<Issue>>;
  get(owner: string, repo: string, number: number): Promise<Issue>;
  create(owner: string, repo: string, input: CreateIssueInput): Promise<Issue>;
  listComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>>;
  getComment(owner: string, repo: string, number: number, commentId: string): Promise<Comment>;
  createComment(
    owner: string,
    repo: string,
    number: number,
    input: CreateCommentInput,
  ): Promise<Comment>;
}

/**
 * Resource accessor for pull requests
 */
export interface PullRequestResource {
  searchGlobal(
    query: string,
    options?: GlobalPullRequestSearchOptions,
  ): Promise<GlobalPullRequestSearchResult>;
  list(owner: string, repo: string, options?: ListOptions): Promise<PageResult<PullRequest>>;
  listFiles(
    owner: string,
    repo: string,
    number: number,
    options?: ListPullRequestFilesOptions,
  ): Promise<PageResult<PullRequestFile>>;
  listChecks(
    owner: string,
    repo: string,
    number: number,
    options?: ListPullRequestChecksOptions,
  ): Promise<PageResult<PullRequestCheck>>;
  listReviews(
    owner: string,
    repo: string,
    number: number,
    options?: ListPullRequestReviewsOptions,
  ): Promise<PageResult<PullRequestReview>>;
  getReview(
    owner: string,
    repo: string,
    number: number,
    reviewId: string,
  ): Promise<PullRequestReview>;
  search(
    owner: string,
    repo: string,
    query: string,
    options?: ListOptions,
  ): Promise<SearchPageResult<PullRequestSearchItem>>;
  get(
    owner: string,
    repo: string,
    number: number,
    options?: GetPullRequestOptions,
  ): Promise<PullRequest>;
  create(owner: string, repo: string, input: CreatePullRequestInput): Promise<PullRequest>;
  update(
    owner: string,
    repo: string,
    number: number,
    input: UpdatePullRequestInput,
  ): Promise<PullRequest>;
  listComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>>;
  getComment(owner: string, repo: string, number: number, commentId: string): Promise<Comment>;
  createComment(
    owner: string,
    repo: string,
    number: number,
    input: CreateCommentInput,
  ): Promise<Comment>;
}

/**
 * Resource accessor for users
 */
export interface UserResource {
  get(username: string): Promise<User>;
  authenticated(): Promise<User>;
}

/**
 * Resource accessor for pull-request review threads
 */
export interface ThreadResource {
  list(
    owner: string,
    repo: string,
    number: number,
    options?: ListThreadOptions,
  ): Promise<PageResult<Thread>>;
  get(owner: string, repo: string, number: number, threadId: string): Promise<Thread>;
  reply(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
    input: ReplyThreadInput,
  ): Promise<ThreadComment>;
  resolve(owner: string, repo: string, number: number, threadId: string): Promise<Thread>;
  unresolve(owner: string, repo: string, number: number, threadId: string): Promise<Thread>;
}

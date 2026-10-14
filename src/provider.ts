/**
 * Runtime contract shared by all git provider implementations.
 */

import { assertAssignees } from "./assignees.ts";
import { ForgesError, NotFoundError } from "./errors.ts";
import { assertCommitPatchOptions } from "./commit-patch.ts";
import { assertCiId, assertCiJobLogOptions } from "./ci-job-log.ts";
import { assertIssueUpdate, assertMergeInput, assertPullRequestUpdate } from "./update-input.ts";
import { assertRepositoryContentsOptions, normalizeRepositoryPath } from "./repository-contents.ts";
import type {
  CiJob,
  CiJobLog,
  CiJobLogOptions,
  CiRun,
  CiRunResource,
  CodeSearchItem,
  CodeSearchOptions,
  CodeSearchResource,
  Comment,
  Commit,
  CommitComparison,
  CommitPatch,
  CommitPatchOptions,
  ContributionTemplate,
  ContributionTemplateKind,
  ContributionTemplateResource,
  ContributionTemplateSummary,
  CommitResource,
  CommitSummary,
  CommitSearchOptions,
  CommitSearchResult,
  CompareCommitsOptions,
  CreateCommentInput,
  CreateIssueInput,
  CreatePullRequestInput,
  CreateReleaseInput,
  Issue,
  IssueResource,
  ListCiJobsOptions,
  ListCiRunsOptions,
  ListCommentOptions,
  ListCommitChecksOptions,
  ListCommitOptions,
  ListContributionTemplatesOptions,
  ListOptions,
  ListPullRequestChecksOptions,
  ListPullRequestFilesOptions,
  ListPullRequestReviewsOptions,
  ListReactionOptions,
  ListReleasesOptions,
  ListTagsOptions,
  ListThreadOptions,
  MergePullRequestInput,
  Owner,
  PageResult,
  PullRequest,
  ClosingIssue,
  PullRequestCheck,
  PullRequestFile,
  PullRequestResource,
  PullRequestReview,
  PullRequestSearchItem,
  Reaction,
  GlobalPullRequestSearchOptions,
  GlobalPullRequestSearchResult,
  GlobalIssueSearchOptions,
  GlobalIssueSearchResult,
  Release,
  ReleaseResource,
  ReplyThreadInput,
  Repository,
  RepositoryContents,
  RepositoryContentsOptions,
  RepositoryResource,
  SearchPageResult,
  Tag,
  Thread,
  ThreadComment,
  ThreadResource,
  ThreadState,
  UpdateIssueInput,
  UpdatePullRequestInput,
  UpdateReleaseInput,
  User,
  UserResource,
} from "./types.ts";

/**
 * Provider-specific response types consumed by the mapping contract.
 *
 * Concrete providers supply their raw API response types when extending
 * {@link Provider}.
 */
export interface ProviderRawTypes {
  owner: unknown;
  repository: unknown;
  issue: unknown;
  pullRequest: unknown;
  user: unknown;
  thread: unknown;
  comment: unknown;
}

function paginationPageValue(
  value: number | undefined,
  fallback: number,
  label: string,
  platform: string | undefined,
  maximum?: number,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    (maximum !== undefined && resolved > maximum)
  ) {
    const range = maximum === undefined ? "a positive integer" : `an integer from 1 to ${maximum}`;
    throw new ForgesError(`${label} must be ${range}`, 400, platform);
  }
  return resolved;
}

interface ContributionTemplatePagination {
  page: number;
  perPage: number;
}

function contributionTemplatePagination(
  options: ListContributionTemplatesOptions | undefined,
  platform: string | undefined,
): ContributionTemplatePagination {
  return {
    page: paginationPageValue(options?.page, 1, "page", platform),
    perPage: paginationPageValue(options?.perPage, 30, "perPage", platform, 100),
  };
}

function paginateContributionTemplates(
  templates: readonly ContributionTemplateSummary[],
  pagination: ContributionTemplatePagination,
): PageResult<ContributionTemplateSummary> {
  const { page, perPage } = pagination;
  const start = (page - 1) * perPage;
  const items = templates.slice(start, start + perPage);
  const hasNextPage = start + items.length < templates.length;
  return {
    items,
    totalCount: templates.length,
    hasNextPage,
    nextPage: hasNextPage ? page + 1 : undefined,
  };
}

function assertReleaseTag(tag: string, platform?: string): void {
  if (tag.trim() === "") {
    throw new ForgesError("Release tag must not be empty", 400, platform);
  }
}

/** Checks shared by pull request and issue search across repositories, before any request. */
function assertGlobalSearch(
  noun: "Pull-request" | "Issue",
  query: string,
  options: GlobalIssueSearchOptions | undefined,
  platform?: string,
): void {
  if (options?.author !== undefined && !/^[^\s:'"]+$/u.test(options.author)) {
    throw new ForgesError(`${noun} search author must be a single login`, 400, platform);
  }
  if (options?.owner !== undefined && !/^\S+$/u.test(options.owner)) {
    throw new ForgesError(`${noun} search owner must be one name without spaces`, 400, platform);
  }
  const labelled = noun === "Issue" && (options?.labels?.length ?? 0) > 0;
  const scoped = options?.author !== undefined || options?.owner !== undefined || labelled;
  if (query.trim() === "" && !scoped) {
    throw new ForgesError(
      noun === "Issue"
        ? "Issue search needs a query, an author, a label or an owner"
        : `${noun} search needs a query, an author or an owner`,
      400,
      platform,
    );
  }
  if (options?.repo !== undefined && options.owner === undefined) {
    throw new ForgesError(`${noun} search repository scope requires an owner`, 400, platform);
  }
}

/** Gitea and GitLab split labels on commas and GitHub quotes each one. */
function assertGlobalIssueFilters(
  options: GlobalIssueSearchOptions | undefined,
  platform?: string,
): void {
  if (options?.state !== undefined && !["open", "closed", "all"].includes(options.state)) {
    throw new ForgesError("Issue search state must be open, closed or all", 400, platform);
  }
  if ((options?.labels?.length ?? 0) > 10) {
    throw new ForgesError("Issue search takes at most 10 labels", 400, platform);
  }
  for (const [index, label] of (options?.labels ?? []).entries()) {
    if (label.trim() === "" || /[,"\p{Cc}]/u.test(label)) {
      throw new ForgesError(
        `Issue search label ${index + 1} must be a name without commas or double quotes`,
        400,
        platform,
      );
    }
  }
}

/** A blank comment is never what the caller meant, so it fails here without a request. */
function assertCommentBody(body: string, platform?: string): void {
  if (body.trim() === "") {
    throw new ForgesError("Comment body must not be empty", 400, platform);
  }
}

/**
 * Abstract base for every git provider.
 *
 * Owns the unified resource surface while concrete providers implement the
 * platform-specific mapping and API operations.
 */
export abstract class Provider<Raw extends ProviderRawTypes = ProviderRawTypes> {
  public readonly repos: RepositoryResource;
  public readonly contributionTemplates: ContributionTemplateResource;
  public readonly code: CodeSearchResource;
  public readonly ciRuns: CiRunResource;
  public readonly commits: CommitResource;
  public readonly releases: ReleaseResource;
  public readonly issues: IssueResource;
  public readonly pullRequests: PullRequestResource;
  public readonly users: UserResource;
  public readonly threads: ThreadResource;
  /** Named on every refusal from the base class, which runs before any platform code. */
  readonly #platform: string | undefined;

  protected constructor(platform?: string) {
    this.#platform = platform;
    this.repos = {
      list: (owner, options) => this.listRepos(owner, options),
      get: (owner, repo) => this.getRepo(owner, repo),
      readContents: async (owner, repo, path, options) => {
        assertRepositoryContentsOptions(options, this.#platform);
        const normalizedPath = normalizeRepositoryPath(path, this.#platform);
        return this.readRepositoryContents(owner, repo, normalizedPath, options);
      },
      listTags: (owner, repo, options) => this.listTags(owner, repo, options),
    };
    this.contributionTemplates = {
      list: async (owner, repo, kind, options) => {
        const pagination = contributionTemplatePagination(options, this.#platform);
        const templates = await this.listContributionTemplates(owner, repo, kind);
        return paginateContributionTemplates(templates, pagination);
      },
      get: async (owner, repo, kind, key) => {
        if (key.length === 0) {
          throw this.#refusal("Contribution template key must not be empty");
        }
        const templates = await this.listContributionTemplates(owner, repo, kind);
        const template = templates.find((candidate) => candidate.key === key);
        if (!template) {
          throw new NotFoundError(
            `Contribution template not found: ${kind}/${key}`,
            this.#platform,
          );
        }
        const content = await this.readContributionTemplate(owner, repo, template);
        return { ...template, content };
      },
    };
    this.code = {
      search: async (query, options) => {
        if (query.trim() === "") {
          throw this.#refusal("Code search query must not be empty");
        }
        if (options?.repo !== undefined && options.owner === undefined) {
          throw this.#refusal("Code search repository scope requires an owner");
        }
        return this.searchCode(query, options);
      },
    };
    this.ciRuns = {
      list: (owner, repo, options) => this.listCiRuns(owner, repo, options),
      listJobs: async (owner, repo, runId, options) => {
        assertCiId(runId, "run", this.#platform);
        return this.listCiJobs(owner, repo, runId, {
          page: paginationPageValue(options?.page, 1, "page", this.#platform),
          perPage: paginationPageValue(options?.perPage, 30, "perPage", this.#platform, 100),
        });
      },
      readJobLog: async (owner, repo, jobId, options) => {
        assertCiId(jobId, "job", this.#platform);
        assertCiJobLogOptions(options, this.#platform);
        return this.readCiJobLog(owner, repo, jobId, options);
      },
    };
    this.commits = {
      search: async (query, options) => {
        if (query.trim() === "") {
          throw this.#refusal("Commit search query must not be empty");
        }
        if (options?.repo !== undefined && options.owner === undefined) {
          throw this.#refusal("Commit search repository scope requires an owner");
        }
        return this.searchCommits(query, options);
      },
      list: (owner, repo, options) => this.listCommits(owner, repo, options),
      get: (owner, repo, sha) => this.getCommit(owner, repo, sha),
      listChecks: async (owner, repo, ref, options) => {
        if (ref.trim() === "") {
          throw this.#refusal("Commit checks need a SHA, branch or tag");
        }
        this.#assertCheckPage(options);
        return this.listCommitChecks(owner, repo, ref, options);
      },
      compare: async (owner, repo, base, head, options) => {
        if (base.trim() === "" || head.trim() === "") {
          throw this.#refusal("Commit comparison needs a base and a head ref");
        }
        return this.compareCommits(owner, repo, base, head, {
          page: paginationPageValue(options?.page, 1, "page", this.#platform),
          perPage: paginationPageValue(options?.perPage, 30, "perPage", this.#platform, 100),
        });
      },
      readPatch: async (owner, repo, sha, options) => {
        assertCommitPatchOptions(options, this.#platform);
        return this.readCommitPatch(owner, repo, sha, options);
      },
    };
    this.releases = {
      list: (owner, repo, options) => this.listReleases(owner, repo, options),
      get: async (owner, repo, tag) => {
        assertReleaseTag(tag, this.#platform);
        return this.getRelease(owner, repo, tag);
      },
      create: async (owner, repo, input) => {
        assertReleaseTag(input.tag, this.#platform);
        return this.createRelease(owner, repo, input);
      },
      update: async (owner, repo, tag, input) => {
        assertReleaseTag(tag, this.#platform);
        if (Object.values(input).every((value) => value === undefined)) {
          throw this.#refusal("Release update needs at least one field");
        }
        return this.updateRelease(owner, repo, tag, input);
      },
    };
    this.issues = {
      searchGlobal: async (query, options) => {
        assertGlobalSearch("Issue", query, options, this.#platform);
        assertGlobalIssueFilters(options, this.#platform);
        return this.searchIssuesGlobal(query, options);
      },
      list: (owner, repo, options) => this.listIssues(owner, repo, options),
      search: async (owner, repo, query, options) => {
        if (query.trim() === "") {
          throw this.#refusal("Issue search query must not be empty");
        }
        return this.searchIssues(owner, repo, query, options);
      },
      get: (owner, repo, number) => this.getIssue(owner, repo, number),
      create: async (owner, repo, input) => {
        assertAssignees(input.assignees, this.#platform);
        return this.createIssue(owner, repo, input);
      },
      update: async (owner, repo, number, input) => {
        assertIssueUpdate(input, this.#platform);
        return this.updateIssue(owner, repo, number, input);
      },
      listComments: (owner, repo, number, options) =>
        this.listIssueComments(owner, repo, number, options),
      getComment: (owner, repo, number, commentId) =>
        this.getIssueComment(owner, repo, number, commentId),
      createComment: async (owner, repo, number, input) => {
        assertCommentBody(input.body, this.#platform);
        return this.createIssueComment(owner, repo, number, input);
      },
      listReactions: (owner, repo, number, options) =>
        this.listIssueReactions(owner, repo, number, options),
    };
    this.pullRequests = {
      searchGlobal: async (query, options) => {
        assertGlobalSearch("Pull-request", query, options, this.#platform);
        return this.searchPullRequestsGlobal(query, options);
      },
      list: (owner, repo, options) => this.listPullRequests(owner, repo, options),
      listFiles: (owner, repo, number, options) =>
        this.listPullRequestFiles(owner, repo, number, options),
      listChecks: async (owner, repo, number, options) => {
        this.#assertCheckPage(options);
        return this.listPullRequestChecks(owner, repo, number, options);
      },
      listReviews: (owner, repo, number, options) =>
        this.listPullRequestReviews(owner, repo, number, options),
      getReview: (owner, repo, number, reviewId) =>
        this.getPullRequestReview(owner, repo, number, reviewId),
      search: async (owner, repo, query, options) => {
        if (query.trim() === "") {
          throw this.#refusal("Pull-request search query must not be empty");
        }
        return this.searchPullRequests(owner, repo, query, options);
      },
      get: async (owner, repo, number, options) => {
        if (options?.closingIssues !== true) return this.getPullRequest(owner, repo, number);
        const [pullRequest, closingIssues] = await Promise.all([
          this.getPullRequest(owner, repo, number),
          this.listClosingIssues(owner, repo, number),
        ]);
        return { ...pullRequest, closingIssues };
      },
      create: async (owner, repo, input) => {
        assertAssignees(input.assignees, this.#platform);
        return this.createPullRequest(owner, repo, input);
      },
      update: async (owner, repo, number, input) => {
        assertPullRequestUpdate(input, this.#platform);
        return this.updatePullRequest(owner, repo, number, input);
      },
      merge: async (owner, repo, number, input = {}) => {
        assertMergeInput(input, this.#platform);
        return this.mergePullRequest(owner, repo, number, input);
      },
      listComments: (owner, repo, number, options) =>
        this.listPullRequestComments(owner, repo, number, options),
      getComment: (owner, repo, number, commentId) =>
        this.getPullRequestComment(owner, repo, number, commentId),
      createComment: async (owner, repo, number, input) => {
        assertCommentBody(input.body, this.#platform);
        return this.createPullRequestComment(owner, repo, number, input);
      },
      listReactions: (owner, repo, number, options) =>
        this.listPullRequestReactions(owner, repo, number, options),
    };
    this.users = {
      get: (username) => this.getUser(username),
      authenticated: () => this.getAuthenticatedUser(),
    };
    this.threads = {
      list: (owner, repo, number, options) => this.listThreads(owner, repo, number, options),
      get: (owner, repo, number, threadId) => this.getThread(owner, repo, number, threadId),
      reply: (owner, repo, number, threadId, input) =>
        this.replyToThread(owner, repo, number, threadId, input),
      resolve: (owner, repo, number, threadId) => this.resolveThread(owner, repo, number, threadId),
      unresolve: (owner, repo, number, threadId) =>
        this.unresolveThread(owner, repo, number, threadId),
    };
  }

  #refusal(message: string): ForgesError {
    return new ForgesError(message, 400, this.#platform);
  }

  #assertCheckPage(options: ListPullRequestChecksOptions | undefined): void {
    const page = paginationPageValue(options?.page, 1, "page", this.#platform);
    const perPage = paginationPageValue(options?.perPage, 30, "perPage", this.#platform, 100);
    if (!Number.isSafeInteger(page * perPage + 1)) {
      throw this.#refusal("Check pagination exceeds the safe integer range");
    }
  }

  #unsupported(message: string): Promise<never> {
    return Promise.reject(new ForgesError(message, 501, this.#platform));
  }

  protected abstract mapOwner(raw: Raw["owner"]): Owner;
  protected abstract mapRepository(raw: Raw["repository"]): Repository;
  protected abstract mapIssue(raw: Raw["issue"]): Issue;
  protected abstract mapPullRequest(raw: Raw["pullRequest"]): PullRequest;
  protected abstract mapUser(raw: Raw["user"]): User;
  protected abstract mapThread(raw: Raw["thread"]): Thread;
  protected abstract mapComment(raw: Raw["comment"]): Comment;

  protected abstract listRepos(
    owner: string,
    options?: ListOptions,
  ): Promise<PageResult<Repository>>;
  protected abstract getRepo(owner: string, repo: string): Promise<Repository>;
  protected listContributionTemplates(
    _owner: string,
    _repo: string,
    _kind: ContributionTemplateKind,
  ): Promise<ContributionTemplateSummary[]> {
    return this.#unsupported("Contribution template discovery is not supported by this provider");
  }
  protected readRepositoryContents(
    _owner: string,
    _repo: string,
    _path: string,
    _options?: RepositoryContentsOptions,
  ): Promise<RepositoryContents> {
    return this.#unsupported("Repository contents reads are not supported by this provider");
  }
  protected listTags(
    _owner: string,
    _repo: string,
    _options?: ListTagsOptions,
  ): Promise<PageResult<Tag>> {
    return this.#unsupported("Tag listing is not supported by this provider");
  }
  protected readContributionTemplate(
    _owner: string,
    _repo: string,
    _template: ContributionTemplateSummary,
  ): Promise<ContributionTemplate["content"]> {
    return this.#unsupported("Contribution template reads are not supported by this provider");
  }
  protected searchCode(
    _query: string,
    _options?: CodeSearchOptions,
  ): Promise<SearchPageResult<CodeSearchItem>> {
    return this.#unsupported("Code search is not supported by this provider");
  }
  protected listCiRuns(
    _owner: string,
    _repo: string,
    _options?: ListCiRunsOptions,
  ): Promise<PageResult<CiRun>> {
    return this.#unsupported("CI-run listing is not supported by this provider");
  }
  protected listCiJobs(
    _owner: string,
    _repo: string,
    _runId: string,
    _options?: ListCiJobsOptions,
  ): Promise<PageResult<CiJob>> {
    return this.#unsupported("CI-job listing is not supported by this provider");
  }
  protected readCiJobLog(
    _owner: string,
    _repo: string,
    _jobId: string,
    _options?: CiJobLogOptions,
  ): Promise<CiJobLog> {
    return this.#unsupported("CI-job log reads are not supported by this provider");
  }
  protected searchPullRequestsGlobal(
    _query: string,
    _options?: GlobalPullRequestSearchOptions,
  ): Promise<GlobalPullRequestSearchResult> {
    return this.#unsupported("Global pull-request search is not supported by this provider");
  }
  protected searchIssuesGlobal(
    _query: string,
    _options?: GlobalIssueSearchOptions,
  ): Promise<GlobalIssueSearchResult> {
    return this.#unsupported("Global issue search is not supported by this provider");
  }
  protected searchCommits(
    _query: string,
    _options?: CommitSearchOptions,
  ): Promise<CommitSearchResult> {
    return this.#unsupported("Commit search is not supported by this provider");
  }
  protected listCommits(
    _owner: string,
    _repo: string,
    _options?: ListCommitOptions,
  ): Promise<PageResult<CommitSummary>> {
    return this.#unsupported("Commit listing is not supported by this provider");
  }
  protected abstract getCommit(owner: string, repo: string, sha: string): Promise<Commit>;
  protected listCommitChecks(
    _owner: string,
    _repo: string,
    _ref: string,
    _options?: ListCommitChecksOptions,
  ): Promise<PageResult<PullRequestCheck>> {
    return this.#unsupported("Commit checks are not supported by this provider");
  }
  protected compareCommits(
    _owner: string,
    _repo: string,
    _base: string,
    _head: string,
    _options?: CompareCommitsOptions,
  ): Promise<CommitComparison> {
    return this.#unsupported("Commit comparison is not supported by this provider");
  }
  protected readCommitPatch(
    _owner: string,
    _repo: string,
    _sha: string,
    _options?: CommitPatchOptions,
  ): Promise<CommitPatch> {
    return this.#unsupported("Commit patch reads are not supported by this provider");
  }
  protected listReleases(
    _owner: string,
    _repo: string,
    _options?: ListReleasesOptions,
  ): Promise<PageResult<Release>> {
    return this.#unsupported("Releases are not supported by this provider");
  }
  protected getRelease(_owner: string, _repo: string, _tag: string): Promise<Release> {
    return this.#unsupported("Releases are not supported by this provider");
  }
  protected createRelease(
    _owner: string,
    _repo: string,
    _input: CreateReleaseInput,
  ): Promise<Release> {
    return this.#unsupported("Release creation is not supported by this provider");
  }
  protected updateRelease(
    _owner: string,
    _repo: string,
    _tag: string,
    _input: UpdateReleaseInput,
  ): Promise<Release> {
    return this.#unsupported("Release updates are not supported by this provider");
  }
  protected abstract listIssues(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<Issue>>;
  protected searchIssues(
    _owner: string,
    _repo: string,
    _query: string,
    _options?: ListOptions,
  ): Promise<SearchPageResult<Issue>> {
    return this.#unsupported("Issue search is not supported by this provider");
  }
  protected abstract getIssue(owner: string, repo: string, number: number): Promise<Issue>;
  protected abstract createIssue(
    owner: string,
    repo: string,
    input: CreateIssueInput,
  ): Promise<Issue>;
  protected updateIssue(
    _owner: string,
    _repo: string,
    _number: number,
    _input: UpdateIssueInput,
  ): Promise<Issue> {
    return this.#unsupported("Issue updates are not supported by this provider");
  }
  protected abstract listPullRequests(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<PullRequest>>;
  protected listPullRequestFiles(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: ListPullRequestFilesOptions,
  ): Promise<PageResult<PullRequestFile>> {
    return this.#unsupported("Pull request file listing is not supported by this provider");
  }
  protected listPullRequestChecks(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: ListPullRequestChecksOptions,
  ): Promise<PageResult<PullRequestCheck>> {
    return this.#unsupported("Pull request checks are not supported by this provider");
  }
  protected listPullRequestReviews(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: ListPullRequestReviewsOptions,
  ): Promise<PageResult<PullRequestReview>> {
    return this.#unsupported("Pull request reviews are not supported by this provider");
  }
  protected getPullRequestReview(
    _owner: string,
    _repo: string,
    _number: number,
    _reviewId: string,
  ): Promise<PullRequestReview> {
    return this.#unsupported("Individual pull request reviews are not supported by this provider");
  }
  protected searchPullRequests(
    _owner: string,
    _repo: string,
    _query: string,
    _options?: ListOptions,
  ): Promise<SearchPageResult<PullRequestSearchItem>> {
    return this.#unsupported("Pull-request search is not supported by this provider");
  }
  protected abstract getPullRequest(
    owner: string,
    repo: string,
    number: number,
  ): Promise<PullRequest>;
  /** Null means the provider cannot tell which issues a pull request closes. */
  protected listClosingIssues(
    _owner: string,
    _repo: string,
    _number: number,
  ): Promise<ClosingIssue[] | null> {
    return Promise.resolve(null);
  }
  protected abstract createPullRequest(
    owner: string,
    repo: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequest>;
  protected updatePullRequest(
    _owner: string,
    _repo: string,
    _number: number,
    _input: UpdatePullRequestInput,
  ): Promise<PullRequest> {
    return this.#unsupported("Pull request updates are not supported by this provider");
  }
  protected mergePullRequest(
    _owner: string,
    _repo: string,
    _number: number,
    _input: MergePullRequestInput,
  ): Promise<PullRequest> {
    return this.#unsupported("Pull request merges are not supported by this provider");
  }
  protected abstract listIssueComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>>;
  protected abstract listPullRequestComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>>;
  protected abstract getIssueComment(
    owner: string,
    repo: string,
    number: number,
    commentId: string,
  ): Promise<Comment>;
  protected abstract getPullRequestComment(
    owner: string,
    repo: string,
    number: number,
    commentId: string,
  ): Promise<Comment>;
  protected createIssueComment(
    _owner: string,
    _repo: string,
    _number: number,
    _input: CreateCommentInput,
  ): Promise<Comment> {
    return this.#unsupported("Issue comments are not supported by this provider");
  }
  protected createPullRequestComment(
    _owner: string,
    _repo: string,
    _number: number,
    _input: CreateCommentInput,
  ): Promise<Comment> {
    return this.#unsupported("Pull request comments are not supported by this provider");
  }
  protected listIssueReactions(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: ListReactionOptions,
  ): Promise<PageResult<Reaction>> {
    return this.#unsupported("Issue reactions are not supported by this provider");
  }
  protected listPullRequestReactions(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: ListReactionOptions,
  ): Promise<PageResult<Reaction>> {
    return this.#unsupported("Pull request reactions are not supported by this provider");
  }
  protected abstract getUser(username: string): Promise<User>;
  protected abstract getAuthenticatedUser(): Promise<User>;
  protected abstract listThreads(
    owner: string,
    repo: string,
    number: number,
    options?: ListThreadOptions,
  ): Promise<PageResult<Thread>>;
  protected abstract getThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread>;
  protected abstract replyToThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
    input: ReplyThreadInput,
  ): Promise<ThreadComment>;
  protected abstract resolveThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread>;
  protected abstract unresolveThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread>;

  protected filterThreadsByState(threads: Thread[], state?: ThreadState): Thread[] {
    if (state === undefined || state === "all") {
      return threads;
    }
    const resolved = state === "resolved";
    return threads.filter((thread) => thread.isResolved === resolved);
  }
}

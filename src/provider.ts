/**
 * Runtime contract shared by all git provider implementations.
 */

import { assertAssignees } from "./assignees.ts";
import { ForgesError, NotFoundError } from "./errors.ts";
import { assertCommitPatchOptions } from "./commit-patch.ts";
import { assertCiId, assertCiJobLogOptions } from "./ci-job-log.ts";
import { assertIssueUpdate, assertPullRequestUpdate } from "./update-input.ts";
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
  CreateCommentInput,
  CreateIssueInput,
  CreatePullRequestInput,
  CreateReleaseInput,
  Issue,
  IssueResource,
  ListCiJobsOptions,
  ListCiRunsOptions,
  ListCommentOptions,
  ListCommitOptions,
  ListContributionTemplatesOptions,
  ListOptions,
  ListPullRequestChecksOptions,
  ListPullRequestFilesOptions,
  ListPullRequestReviewsOptions,
  ListReleasesOptions,
  ListThreadOptions,
  Owner,
  PageResult,
  PullRequest,
  ClosingIssue,
  PullRequestCheck,
  PullRequestFile,
  PullRequestResource,
  PullRequestReview,
  PullRequestSearchItem,
  GlobalPullRequestSearchOptions,
  GlobalPullRequestSearchResult,
  Release,
  ReleaseResource,
  ReplyThreadInput,
  Repository,
  RepositoryContents,
  RepositoryContentsOptions,
  RepositoryResource,
  SearchPageResult,
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
  maximum?: number,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    (maximum !== undefined && resolved > maximum)
  ) {
    const range = maximum === undefined ? "a positive integer" : `an integer from 1 to ${maximum}`;
    throw new ForgesError(`${label} must be ${range}`, 400);
  }
  return resolved;
}

interface ContributionTemplatePagination {
  page: number;
  perPage: number;
}

function contributionTemplatePagination(
  options?: ListContributionTemplatesOptions,
): ContributionTemplatePagination {
  return {
    page: paginationPageValue(options?.page, 1, "page"),
    perPage: paginationPageValue(options?.perPage, 30, "perPage", 100),
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

function assertReleaseTag(tag: string): void {
  if (tag.trim() === "") {
    throw new ForgesError("Release tag must not be empty", 400);
  }
}

/** A blank comment is never what the caller meant, so it fails here without a request. */
function assertCommentBody(body: string): void {
  if (body.trim() === "") {
    throw new ForgesError("Comment body must not be empty", 400);
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

  protected constructor() {
    this.repos = {
      list: (owner, options) => this.listRepos(owner, options),
      get: (owner, repo) => this.getRepo(owner, repo),
      readContents: async (owner, repo, path, options) => {
        assertRepositoryContentsOptions(options);
        return this.readRepositoryContents(owner, repo, normalizeRepositoryPath(path), options);
      },
    };
    this.contributionTemplates = {
      list: async (owner, repo, kind, options) => {
        const pagination = contributionTemplatePagination(options);
        const templates = await this.listContributionTemplates(owner, repo, kind);
        return paginateContributionTemplates(templates, pagination);
      },
      get: async (owner, repo, kind, key) => {
        if (key.length === 0) {
          throw new ForgesError("Contribution template key must not be empty", 400);
        }
        const templates = await this.listContributionTemplates(owner, repo, kind);
        const template = templates.find((candidate) => candidate.key === key);
        if (!template) {
          throw new NotFoundError(`Contribution template not found: ${kind}/${key}`);
        }
        const content = await this.readContributionTemplate(owner, repo, template);
        return { ...template, content };
      },
    };
    this.code = {
      search: async (query, options) => {
        if (query.trim() === "") {
          throw new ForgesError("Code search query must not be empty", 400);
        }
        if (options?.repo !== undefined && options.owner === undefined) {
          throw new ForgesError("Code search repository scope requires an owner", 400);
        }
        return this.searchCode(query, options);
      },
    };
    this.ciRuns = {
      list: (owner, repo, options) => this.listCiRuns(owner, repo, options),
      listJobs: async (owner, repo, runId, options) => {
        assertCiId(runId, "run");
        return this.listCiJobs(owner, repo, runId, options);
      },
      readJobLog: async (owner, repo, jobId, options) => {
        assertCiId(jobId, "job");
        assertCiJobLogOptions(options);
        return this.readCiJobLog(owner, repo, jobId, options);
      },
    };
    this.commits = {
      search: async (query, options) => {
        if (query.trim() === "") {
          throw new ForgesError("Commit search query must not be empty", 400);
        }
        if (options?.repo !== undefined && options.owner === undefined) {
          throw new ForgesError("Commit search repository scope requires an owner", 400);
        }
        return this.searchCommits(query, options);
      },
      list: (owner, repo, options) => this.listCommits(owner, repo, options),
      get: (owner, repo, sha) => this.getCommit(owner, repo, sha),
      readPatch: async (owner, repo, sha, options) => {
        assertCommitPatchOptions(options);
        return this.readCommitPatch(owner, repo, sha, options);
      },
    };
    this.releases = {
      list: (owner, repo, options) => this.listReleases(owner, repo, options),
      get: async (owner, repo, tag) => {
        assertReleaseTag(tag);
        return this.getRelease(owner, repo, tag);
      },
      create: async (owner, repo, input) => {
        assertReleaseTag(input.tag);
        return this.createRelease(owner, repo, input);
      },
      update: async (owner, repo, tag, input) => {
        assertReleaseTag(tag);
        if (Object.values(input).every((value) => value === undefined)) {
          throw new ForgesError("Release update needs at least one field", 400);
        }
        return this.updateRelease(owner, repo, tag, input);
      },
    };
    this.issues = {
      list: (owner, repo, options) => this.listIssues(owner, repo, options),
      search: async (owner, repo, query, options) => {
        if (query.trim() === "") {
          throw new ForgesError("Issue search query must not be empty", 400);
        }
        return this.searchIssues(owner, repo, query, options);
      },
      get: (owner, repo, number) => this.getIssue(owner, repo, number),
      create: async (owner, repo, input) => {
        assertAssignees(input.assignees);
        return this.createIssue(owner, repo, input);
      },
      update: async (owner, repo, number, input) => {
        assertIssueUpdate(input);
        return this.updateIssue(owner, repo, number, input);
      },
      listComments: (owner, repo, number, options) =>
        this.listIssueComments(owner, repo, number, options),
      getComment: (owner, repo, number, commentId) =>
        this.getIssueComment(owner, repo, number, commentId),
      createComment: async (owner, repo, number, input) => {
        assertCommentBody(input.body);
        return this.createIssueComment(owner, repo, number, input);
      },
    };
    this.pullRequests = {
      searchGlobal: async (query, options) => {
        if (options?.author !== undefined && !/^[^\s:'"]+$/u.test(options.author)) {
          throw new ForgesError("Pull-request search author must be a single login", 400);
        }
        if (query.trim() === "" && options?.author === undefined) {
          throw new ForgesError("Pull-request search needs a query or an author", 400);
        }
        if (options?.repo !== undefined && options.owner === undefined) {
          throw new ForgesError("Pull-request search repository scope requires an owner", 400);
        }
        return this.searchPullRequestsGlobal(query, options);
      },
      list: (owner, repo, options) => this.listPullRequests(owner, repo, options),
      listFiles: (owner, repo, number, options) =>
        this.listPullRequestFiles(owner, repo, number, options),
      listChecks: async (owner, repo, number, options) => {
        const page = paginationPageValue(options?.page, 1, "page");
        const perPage = paginationPageValue(options?.perPage, 30, "perPage", 100);
        if (!Number.isSafeInteger(page * perPage + 1)) {
          throw new ForgesError("Check pagination exceeds the safe integer range", 400);
        }
        return this.listPullRequestChecks(owner, repo, number, options);
      },
      listReviews: (owner, repo, number, options) =>
        this.listPullRequestReviews(owner, repo, number, options),
      getReview: (owner, repo, number, reviewId) =>
        this.getPullRequestReview(owner, repo, number, reviewId),
      search: async (owner, repo, query, options) => {
        if (query.trim() === "") {
          throw new ForgesError("Pull-request search query must not be empty", 400);
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
        assertAssignees(input.assignees);
        return this.createPullRequest(owner, repo, input);
      },
      update: async (owner, repo, number, input) => {
        assertPullRequestUpdate(input);
        return this.updatePullRequest(owner, repo, number, input);
      },
      listComments: (owner, repo, number, options) =>
        this.listPullRequestComments(owner, repo, number, options),
      getComment: (owner, repo, number, commentId) =>
        this.getPullRequestComment(owner, repo, number, commentId),
      createComment: async (owner, repo, number, input) => {
        assertCommentBody(input.body);
        return this.createPullRequestComment(owner, repo, number, input);
      },
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
    return Promise.reject(
      new ForgesError("Contribution template discovery is not supported by this provider", 501),
    );
  }
  protected readRepositoryContents(
    _owner: string,
    _repo: string,
    _path: string,
    _options?: RepositoryContentsOptions,
  ): Promise<RepositoryContents> {
    return Promise.reject(
      new ForgesError("Repository contents reads are not supported by this provider", 501),
    );
  }
  protected readContributionTemplate(
    _owner: string,
    _repo: string,
    _template: ContributionTemplateSummary,
  ): Promise<ContributionTemplate["content"]> {
    return Promise.reject(
      new ForgesError("Contribution template reads are not supported by this provider", 501),
    );
  }
  protected searchCode(
    _query: string,
    _options?: CodeSearchOptions,
  ): Promise<SearchPageResult<CodeSearchItem>> {
    return Promise.reject(new ForgesError("Code search is not supported by this provider", 501));
  }
  protected listCiRuns(
    _owner: string,
    _repo: string,
    _options?: ListCiRunsOptions,
  ): Promise<PageResult<CiRun>> {
    return Promise.reject(new ForgesError("CI-run listing is not supported by this provider", 501));
  }
  protected listCiJobs(
    _owner: string,
    _repo: string,
    _runId: string,
    _options?: ListCiJobsOptions,
  ): Promise<PageResult<CiJob>> {
    return Promise.reject(new ForgesError("CI-job listing is not supported by this provider", 501));
  }
  protected readCiJobLog(
    _owner: string,
    _repo: string,
    _jobId: string,
    _options?: CiJobLogOptions,
  ): Promise<CiJobLog> {
    return Promise.reject(
      new ForgesError("CI-job log reads are not supported by this provider", 501),
    );
  }
  protected searchPullRequestsGlobal(
    _query: string,
    _options?: GlobalPullRequestSearchOptions,
  ): Promise<GlobalPullRequestSearchResult> {
    return Promise.reject(
      new ForgesError("Global pull-request search is not supported by this provider", 501),
    );
  }
  protected searchCommits(
    _query: string,
    _options?: CommitSearchOptions,
  ): Promise<CommitSearchResult> {
    return Promise.reject(new ForgesError("Commit search is not supported by this provider", 501));
  }
  protected listCommits(
    _owner: string,
    _repo: string,
    _options?: ListCommitOptions,
  ): Promise<PageResult<CommitSummary>> {
    return Promise.reject(new ForgesError("Commit listing is not supported by this provider", 501));
  }
  protected abstract getCommit(owner: string, repo: string, sha: string): Promise<Commit>;
  protected readCommitPatch(
    _owner: string,
    _repo: string,
    _sha: string,
    _options?: CommitPatchOptions,
  ): Promise<CommitPatch> {
    return Promise.reject(
      new ForgesError("Commit patch reads are not supported by this provider", 501),
    );
  }
  protected listReleases(
    _owner: string,
    _repo: string,
    _options?: ListReleasesOptions,
  ): Promise<PageResult<Release>> {
    return Promise.reject(new ForgesError("Releases are not supported by this provider", 501));
  }
  protected getRelease(_owner: string, _repo: string, _tag: string): Promise<Release> {
    return Promise.reject(new ForgesError("Releases are not supported by this provider", 501));
  }
  protected createRelease(
    _owner: string,
    _repo: string,
    _input: CreateReleaseInput,
  ): Promise<Release> {
    return Promise.reject(
      new ForgesError("Release creation is not supported by this provider", 501),
    );
  }
  protected updateRelease(
    _owner: string,
    _repo: string,
    _tag: string,
    _input: UpdateReleaseInput,
  ): Promise<Release> {
    return Promise.reject(
      new ForgesError("Release updates are not supported by this provider", 501),
    );
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
    return Promise.reject(new ForgesError("Issue search is not supported by this provider", 501));
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
    return Promise.reject(new ForgesError("Issue updates are not supported by this provider", 501));
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
    return Promise.reject(
      new ForgesError("Pull request file listing is not supported by this provider", 501),
    );
  }
  protected listPullRequestChecks(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: ListPullRequestChecksOptions,
  ): Promise<PageResult<PullRequestCheck>> {
    return Promise.reject(
      new ForgesError("Pull request checks are not supported by this provider", 501),
    );
  }
  protected listPullRequestReviews(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: ListPullRequestReviewsOptions,
  ): Promise<PageResult<PullRequestReview>> {
    return Promise.reject(
      new ForgesError("Pull request reviews are not supported by this provider", 501),
    );
  }
  protected getPullRequestReview(
    _owner: string,
    _repo: string,
    _number: number,
    _reviewId: string,
  ): Promise<PullRequestReview> {
    return Promise.reject(
      new ForgesError("Individual pull request reviews are not supported by this provider", 501),
    );
  }
  protected searchPullRequests(
    _owner: string,
    _repo: string,
    _query: string,
    _options?: ListOptions,
  ): Promise<SearchPageResult<PullRequestSearchItem>> {
    return Promise.reject(
      new ForgesError("Pull-request search is not supported by this provider", 501),
    );
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
    return Promise.reject(
      new ForgesError("Pull request updates are not supported by this provider", 501),
    );
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
    return Promise.reject(
      new ForgesError("Issue comments are not supported by this provider", 501),
    );
  }
  protected createPullRequestComment(
    _owner: string,
    _repo: string,
    _number: number,
    _input: CreateCommentInput,
  ): Promise<Comment> {
    return Promise.reject(
      new ForgesError("Pull request comments are not supported by this provider", 501),
    );
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

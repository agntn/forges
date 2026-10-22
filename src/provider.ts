/**
 * Runtime contract shared by all git provider implementations.
 */

import { assertAssignees } from "./assignees.ts";
import { cursorScope, decodeCursor, encodeCursor, type PagePosition } from "./cursor.ts";
import { ForgesError, NotFoundError } from "./errors.ts";
import { assertCommitPatchOptions } from "./commit-patch.ts";
import { assertCiId, assertCiJobLogOptions } from "./ci-job-log.ts";
import { assertIssueUpdate, assertMergeInput, assertPullRequestUpdate } from "./update-input.ts";
import { assertRepositoryContentsOptions, normalizeRepositoryPath } from "./repository-contents.ts";
import type {
  AddSubIssueInput,
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
  IssueRef,
  IssueResource,
  RepoRef,
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
  SubIssue,
  SubIssueInput,
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

/** A page as a provider that counts pages returns it; the base class writes its cursor. */
export type Numbered<R extends PageResult<unknown>> = Omit<R, "nextCursor"> & {
  hasNextPage: boolean;
  nextPage?: number;
};

/** One counted page of `T`. */
export type NumberedPage<T> = Numbered<PageResult<T>>;

/** One counted page of search hits. */
export type NumberedSearchPage<T> = Numbered<SearchPageResult<T>>;

/** Options as a provider that counts pages reads them. */
export type WithPage<O> = Omit<O, "cursor"> & { page?: number };

/** Options with the cursor read back; a provider that counts pages reads `page`. */
export type Positioned<O> = Omit<O, "cursor"> & { at?: PagePosition; page?: number };

/** A page that names where the next one starts; the base class writes it as a cursor. */
export type Continued<R extends PageResult<unknown>> = Omit<R, "nextCursor"> & {
  next?: PagePosition;
};

/** One continued page of `T`. */
export type ContinuedPage<T> = Continued<PageResult<T>>;

/** One pagination field: its name, its default and, for a page size, its ceiling. */
interface PaginationField {
  label: string;
  fallback: number;
  maximum?: number;
}

const PAGE: PaginationField = { label: "page", fallback: 1 };
const PER_PAGE: PaginationField = { label: "perPage", fallback: 30, maximum: 100 };

function paginationPageValue(
  value: number | undefined,
  field: PaginationField & { platform: string | undefined },
): number {
  const { label, fallback, maximum, platform } = field;
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    (maximum !== undefined && resolved > maximum)
  ) {
    const range = maximum === undefined ? "a positive integer" : `an integer from 1 to ${maximum}`;
    throw new ForgesError(`${label} must be ${range}`, { status: 400, platform });
  }
  return resolved;
}

interface ContributionTemplatePagination {
  page: number;
  perPage: number;
}

/** A listing's name and the request it answers, so its cursors fit no other listing or request. */
interface Listing<O> {
  listing: string;
  subject: readonly unknown[];
  options: O | undefined;
}

/** The fields one argument must carry, each a string or an integer. */
type ArgumentShape = Readonly<Record<string, "string" | "number">>;

const REPO_REF: ArgumentShape = { owner: "string", repo: "string" };
const ISSUE_REF: ArgumentShape = { ...REPO_REF, number: "number" };

/** An old positional call would go out as `/repos/undefined`, so it's refused with its shape. */
function assertArgument(
  value: unknown,
  about: { call: string; shape: ArgumentShape; position: "first" | "second" },
): void {
  const { call, shape, position } = about;
  const fields =
    typeof value === "object" && value !== null && !ArrayBuffer.isView(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const fits =
    fields !== undefined &&
    Object.entries(shape).every(([key, type]) => typeof fields[key] === type);
  if (!fits) {
    throw new TypeError(
      `${call} takes { ${Object.keys(shape).join(", ")} } as its ${position} argument`,
    );
  }
}

function assertRepoRef(repo: RepoRef, call: string): void {
  assertArgument(repo, { call, shape: REPO_REF, position: "first" });
}

function assertIssueRef(issue: IssueRef, call: string): void {
  assertArgument(issue, { call, shape: ISSUE_REF, position: "first" });
}

/** The second argument, which names what the call acts on inside the first. */
function assertInput(input: unknown, about: { call: string; shape: ArgumentShape }): void {
  assertArgument(input, { ...about, position: "second" });
}

function contributionTemplatePagination(
  options: WithPage<ListContributionTemplatesOptions> | undefined,
  platform: string | undefined,
): ContributionTemplatePagination {
  return {
    page: paginationPageValue(options?.page, { ...PAGE, platform }),
    perPage: paginationPageValue(options?.perPage, { ...PER_PAGE, platform }),
  };
}

function paginateContributionTemplates(
  templates: readonly ContributionTemplateSummary[],
  pagination: ContributionTemplatePagination,
): NumberedPage<ContributionTemplateSummary> {
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
    throw new ForgesError("Release tag must not be empty", { status: 400, platform });
  }
}

/** Checks shared by pull request and issue search across repositories, before any request. */
function assertGlobalSearch(
  noun: "Pull-request" | "Issue",
  search: GlobalIssueSearchOptions & { query: string; platform?: string },
): void {
  const { query, platform, ...options } = search;
  if (options.author !== undefined && !/^[^\s:'"]+$/u.test(options.author)) {
    throw new ForgesError(`${noun} search author must be a single login`, {
      status: 400,
      platform,
    });
  }
  if (options.owner !== undefined && !/^\S+$/u.test(options.owner)) {
    throw new ForgesError(`${noun} search owner must be one name without spaces`, {
      status: 400,
      platform,
    });
  }
  const labelled = noun === "Issue" && (options.labels?.length ?? 0) > 0;
  const scoped = options.author !== undefined || options.owner !== undefined || labelled;
  if (query.trim() === "" && !scoped) {
    throw new ForgesError(
      noun === "Issue"
        ? "Issue search needs a query, an author, a label or an owner"
        : `${noun} search needs a query, an author or an owner`,
      { status: 400, platform },
    );
  }
  if (options.repo !== undefined && options.owner === undefined) {
    throw new ForgesError(`${noun} search repository scope requires an owner`, {
      status: 400,
      platform,
    });
  }
}

/** Gitea and GitLab split labels on commas and GitHub quotes each one. */
function assertGlobalIssueFilters(
  options: GlobalIssueSearchOptions | undefined,
  platform?: string,
): void {
  if (options?.state !== undefined && !["open", "closed", "all"].includes(options.state)) {
    throw new ForgesError("Issue search state must be open, closed or all", {
      status: 400,
      platform,
    });
  }
  if ((options?.labels?.length ?? 0) > 10) {
    throw new ForgesError("Issue search takes at most 10 labels", { status: 400, platform });
  }
  for (const [index, label] of (options?.labels ?? []).entries()) {
    if (label.trim() === "" || /[,"\p{Cc}]/u.test(label)) {
      throw new ForgesError(
        `Issue search label ${index + 1} must be a name without commas or double quotes`,
        { status: 400, platform },
      );
    }
  }
}

/** A blank comment is never what the caller meant, so it fails here without a request. */
function assertCommentBody(body: string, platform?: string): void {
  if (body.trim() === "") {
    throw new ForgesError("Comment body must not be empty", { status: 400, platform });
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
      list: (owner, options) =>
        this.#paged({ listing: "repos.list", subject: [owner], options }, (positioned) =>
          this.listRepos(owner, positioned),
        ),
      get: async (ref) => {
        assertRepoRef(ref, "repos.get");
        return this.getRepo(ref.owner, ref.repo);
      },
      readContents: async (ref, request) => {
        assertRepoRef(ref, "repos.readContents");
        assertInput(request, { call: "repos.readContents", shape: { path: "string" } });
        const { path, ...options } = request;
        assertRepositoryContentsOptions(options, this.#platform);
        const normalizedPath = normalizeRepositoryPath(path, this.#platform);
        return this.readRepositoryContents(ref.owner, ref.repo, normalizedPath, options);
      },
      listTags: async (ref, options) => {
        assertRepoRef(ref, "repos.listTags");
        const { owner, repo } = ref;
        return this.#paged(
          { listing: "repos.listTags", subject: [owner, repo], options },
          (positioned) => this.listTags(owner, repo, positioned),
        );
      },
    };
    this.contributionTemplates = {
      list: async (ref, request) => {
        assertRepoRef(ref, "contributionTemplates.list");
        assertInput(request, { call: "contributionTemplates.list", shape: { kind: "string" } });
        const { owner, repo } = ref;
        const { kind, ...options } = request;
        return this.#paged(
          { listing: "contributionTemplates.list", subject: [owner, repo, kind], options },
          async (paged) => {
            const pagination = contributionTemplatePagination(paged, this.#platform);
            const templates = await this.listContributionTemplates(owner, repo, kind);
            return paginateContributionTemplates(templates, pagination);
          },
        );
      },
      get: async (ref, request) => {
        assertRepoRef(ref, "contributionTemplates.get");
        assertInput(request, {
          call: "contributionTemplates.get",
          shape: { kind: "string", key: "string" },
        });
        const { owner, repo } = ref;
        const { kind, key } = request;
        if (key.length === 0) {
          throw this.#refusal("Contribution template key must not be empty");
        }
        const templates = await this.listContributionTemplates(owner, repo, kind);
        const template = templates.find((candidate) => candidate.key === key);
        if (!template) {
          throw new NotFoundError(`Contribution template not found: ${kind}/${key}`, {
            platform: this.#platform,
          });
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
        return this.#paged({ listing: "code.search", subject: [query], options }, (paged) =>
          this.searchCode(query, paged),
        );
      },
    };
    this.ciRuns = {
      list: async (ref, options) => {
        assertRepoRef(ref, "ciRuns.list");
        const { owner, repo } = ref;
        return this.#paged(
          { listing: "ciRuns.list", subject: [owner, repo], options },
          (positioned) => this.listCiRuns(owner, repo, positioned),
        );
      },
      listJobs: async (ref, request) => {
        assertRepoRef(ref, "ciRuns.listJobs");
        assertInput(request, { call: "ciRuns.listJobs", shape: { runId: "string" } });
        const { owner, repo } = ref;
        const { runId, ...options } = request;
        assertCiId(runId, { kind: "run", platform: this.#platform });
        const perPage = paginationPageValue(options.perPage, {
          ...PER_PAGE,
          platform: this.#platform,
        });
        return this.#paged(
          { listing: "ciRuns.listJobs", subject: [owner, repo, runId], options },
          (positioned) => this.listCiJobs(owner, repo, runId, { ...positioned, perPage }),
        );
      },
      readJobLog: async (ref, request) => {
        assertRepoRef(ref, "ciRuns.readJobLog");
        assertInput(request, { call: "ciRuns.readJobLog", shape: { jobId: "string" } });
        const { jobId, ...options } = request;
        assertCiId(jobId, { kind: "job", platform: this.#platform });
        assertCiJobLogOptions(options, this.#platform);
        return this.readCiJobLog(ref.owner, ref.repo, jobId, options);
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
        return this.#paged({ listing: "commits.search", subject: [query], options }, (paged) =>
          this.searchCommits(query, paged),
        );
      },
      list: async (ref, options) => {
        assertRepoRef(ref, "commits.list");
        const { owner, repo } = ref;
        return this.#paged(
          { listing: "commits.list", subject: [owner, repo], options },
          (positioned) => this.listCommits(owner, repo, positioned),
        );
      },
      get: async (ref, commit) => {
        assertRepoRef(ref, "commits.get");
        assertInput(commit, { call: "commits.get", shape: { sha: "string" } });
        return this.getCommit(ref.owner, ref.repo, commit.sha);
      },
      listChecks: async (ref, request) => {
        assertRepoRef(ref, "commits.listChecks");
        assertInput(request, { call: "commits.listChecks", shape: { ref: "string" } });
        const { owner, repo } = ref;
        const { ref: revision, ...options } = request;
        if (revision.trim() === "") {
          throw this.#refusal("Commit checks need a SHA, branch or tag");
        }
        return this.#paged(
          { listing: "commits.listChecks", subject: [owner, repo, revision], options },
          (paged) => {
            this.#assertCheckPage(paged);
            return this.listCommitChecks(owner, repo, revision, paged);
          },
        );
      },
      compare: async (ref, request) => {
        assertRepoRef(ref, "commits.compare");
        assertInput(request, {
          call: "commits.compare",
          shape: { base: "string", head: "string" },
        });
        const { owner, repo } = ref;
        const { base, head, ...options } = request;
        if (base.trim() === "" || head.trim() === "") {
          throw this.#refusal("Commit comparison needs a base and a head ref");
        }
        return this.#paged(
          { listing: "commits.compare", subject: [owner, repo, base, head], options },
          (paged) =>
            this.compareCommits(owner, repo, base, head, {
              page: paged.page ?? 1,
              perPage: paginationPageValue(options.perPage, {
                ...PER_PAGE,
                platform: this.#platform,
              }),
            }),
        );
      },
      readPatch: async (ref, request) => {
        assertRepoRef(ref, "commits.readPatch");
        assertInput(request, { call: "commits.readPatch", shape: { sha: "string" } });
        const { sha, ...options } = request;
        assertCommitPatchOptions(options, this.#platform);
        return this.readCommitPatch(ref.owner, ref.repo, sha, options);
      },
    };
    this.releases = {
      list: async (ref, options) => {
        assertRepoRef(ref, "releases.list");
        const { owner, repo } = ref;
        return this.#paged(
          { listing: "releases.list", subject: [owner, repo], options },
          (positioned) => this.listReleases(owner, repo, positioned),
        );
      },
      get: async (ref, release) => {
        assertRepoRef(ref, "releases.get");
        assertInput(release, { call: "releases.get", shape: { tag: "string" } });
        assertReleaseTag(release.tag, this.#platform);
        return this.getRelease(ref.owner, ref.repo, release.tag);
      },
      create: async (ref, input) => {
        assertRepoRef(ref, "releases.create");
        assertInput(input, { call: "releases.create", shape: { tag: "string" } });
        assertReleaseTag(input.tag, this.#platform);
        return this.createRelease(ref.owner, ref.repo, input);
      },
      update: async (ref, request) => {
        assertRepoRef(ref, "releases.update");
        assertInput(request, { call: "releases.update", shape: { tag: "string" } });
        const { tag, ...input } = request;
        assertReleaseTag(tag, this.#platform);
        if (Object.values(input).every((value) => value === undefined)) {
          throw this.#refusal("Release update needs at least one field");
        }
        return this.updateRelease(ref.owner, ref.repo, tag, input);
      },
    };
    this.issues = {
      searchGlobal: async (query, options) => {
        assertGlobalSearch("Issue", { ...options, query, platform: this.#platform });
        assertGlobalIssueFilters(options, this.#platform);
        return this.#paged({ listing: "issues.searchGlobal", subject: [query], options }, (paged) =>
          this.searchIssuesGlobal(query, paged),
        );
      },
      list: async (ref, options) => {
        assertRepoRef(ref, "issues.list");
        const { owner, repo } = ref;
        return this.#paged(
          { listing: "issues.list", subject: [owner, repo], options },
          (positioned) => this.listIssues(owner, repo, positioned),
        );
      },
      search: async (ref, request) => {
        assertRepoRef(ref, "issues.search");
        assertInput(request, { call: "issues.search", shape: { query: "string" } });
        const { owner, repo } = ref;
        const { query, ...options } = request;
        if (query.trim() === "") {
          throw this.#refusal("Issue search query must not be empty");
        }
        return this.#paged(
          { listing: "issues.search", subject: [owner, repo, query], options },
          (paged) => this.searchIssues(owner, repo, query, paged),
        );
      },
      get: async (issue) => {
        this.#assertIssue(issue, "issues.get");
        return this.getIssue(issue.owner, issue.repo, issue.number);
      },
      create: async (ref, input) => {
        assertRepoRef(ref, "issues.create");
        assertAssignees(input.assignees, this.#platform);
        return this.createIssue(ref.owner, ref.repo, input);
      },
      update: async (issue, input) => {
        this.#assertIssue(issue, "issues.update");
        assertIssueUpdate(input, this.#platform);
        return this.updateIssue(issue.owner, issue.repo, issue.number, input);
      },
      listComments: async (issue, options) => {
        this.#assertIssue(issue, "issues.listComments");
        const { owner, repo, number } = issue;
        return this.#paged(
          { listing: "issues.listComments", subject: [owner, repo, number], options },
          (paged) => {
            this.#assertListPage(paged);
            return this.listIssueComments(owner, repo, number, paged);
          },
        );
      },
      getComment: async (issue, comment) => {
        this.#assertIssue(issue, "issues.getComment");
        assertInput(comment, { call: "issues.getComment", shape: { commentId: "string" } });
        return this.getIssueComment(issue.owner, issue.repo, issue.number, comment.commentId);
      },
      createComment: async (issue, input) => {
        this.#assertIssue(issue, "issues.createComment");
        assertCommentBody(input.body, this.#platform);
        return this.createIssueComment(issue.owner, issue.repo, issue.number, input);
      },
      listReactions: async (issue, options) => {
        this.#assertIssue(issue, "issues.listReactions");
        const { owner, repo, number } = issue;
        return this.#paged(
          { listing: "issues.listReactions", subject: [owner, repo, number], options },
          (paged) => {
            this.#assertListPage(paged);
            return this.listIssueReactions(owner, repo, number, paged);
          },
        );
      },
      listSubIssues: async (issue, options) => {
        this.#assertIssue(issue, "issues.listSubIssues");
        const { owner, repo, number } = issue;
        return this.#paged(
          { listing: "issues.listSubIssues", subject: [owner, repo, number], options },
          (paged) => {
            this.#assertListPage(paged);
            return this.listSubIssues(issue, paged);
          },
        );
      },
      addSubIssue: async (issue, input) => {
        this.#assertSubIssue(issue, input, "addSubIssue");
        return this.addSubIssue(issue, input);
      },
      removeSubIssue: async (issue, input) => {
        this.#assertSubIssue(issue, input, "removeSubIssue");
        return this.removeSubIssue(issue, input);
      },
    };
    this.pullRequests = {
      searchGlobal: async (query, options) => {
        assertGlobalSearch("Pull-request", { ...options, query, platform: this.#platform });
        return this.#paged(
          { listing: "pullRequests.searchGlobal", subject: [query], options },
          (paged) => this.searchPullRequestsGlobal(query, paged),
        );
      },
      list: async (ref, options) => {
        assertRepoRef(ref, "pullRequests.list");
        const { owner, repo } = ref;
        return this.#paged(
          { listing: "pullRequests.list", subject: [owner, repo], options },
          (paged) => this.listPullRequests(owner, repo, paged),
        );
      },
      listFiles: async (pull, options) => {
        this.#assertIssue(pull, "pullRequests.listFiles");
        const { owner, repo, number } = pull;
        return this.#paged(
          { listing: "pullRequests.listFiles", subject: [owner, repo, number], options },
          (paged) => this.listPullRequestFiles(owner, repo, number, paged),
        );
      },
      listChecks: async (pull, options) => {
        this.#assertIssue(pull, "pullRequests.listChecks");
        const { owner, repo, number } = pull;
        return this.#paged(
          { listing: "pullRequests.listChecks", subject: [owner, repo, number], options },
          (paged) => {
            this.#assertCheckPage(paged);
            return this.listPullRequestChecks(owner, repo, number, paged);
          },
        );
      },
      listReviews: async (pull, options) => {
        this.#assertIssue(pull, "pullRequests.listReviews");
        const { owner, repo, number } = pull;
        return this.#paged(
          { listing: "pullRequests.listReviews", subject: [owner, repo, number], options },
          (paged) => this.listPullRequestReviews(owner, repo, number, paged),
        );
      },
      getReview: async (pull, review) => {
        this.#assertIssue(pull, "pullRequests.getReview");
        assertInput(review, { call: "pullRequests.getReview", shape: { reviewId: "string" } });
        return this.getPullRequestReview(pull.owner, pull.repo, pull.number, review.reviewId);
      },
      search: async (ref, request) => {
        assertRepoRef(ref, "pullRequests.search");
        assertInput(request, { call: "pullRequests.search", shape: { query: "string" } });
        const { owner, repo } = ref;
        const { query, ...options } = request;
        if (query.trim() === "") {
          throw this.#refusal("Pull-request search query must not be empty");
        }
        return this.#paged(
          { listing: "pullRequests.search", subject: [owner, repo, query], options },
          (paged) => this.searchPullRequests(owner, repo, query, paged),
        );
      },
      get: async (pull, options) => {
        this.#assertIssue(pull, "pullRequests.get");
        const { owner, repo, number } = pull;
        if (options?.closingIssues !== true) return this.getPullRequest(owner, repo, number);
        const [pullRequest, closingIssues] = await Promise.all([
          this.getPullRequest(owner, repo, number),
          this.listClosingIssues(owner, repo, number),
        ]);
        return { ...pullRequest, closingIssues };
      },
      create: async (ref, input) => {
        assertRepoRef(ref, "pullRequests.create");
        assertAssignees(input.assignees, this.#platform);
        return this.createPullRequest(ref.owner, ref.repo, input);
      },
      update: async (pull, input) => {
        this.#assertIssue(pull, "pullRequests.update");
        assertPullRequestUpdate(input, this.#platform);
        return this.updatePullRequest(pull.owner, pull.repo, pull.number, input);
      },
      merge: async (pull, input = {}) => {
        this.#assertIssue(pull, "pullRequests.merge");
        assertMergeInput(input, this.#platform);
        return this.mergePullRequest(pull.owner, pull.repo, pull.number, input);
      },
      listComments: async (pull, options) => {
        this.#assertIssue(pull, "pullRequests.listComments");
        const { owner, repo, number } = pull;
        return this.#paged(
          { listing: "pullRequests.listComments", subject: [owner, repo, number], options },
          (paged) => {
            this.#assertListPage(paged);
            return this.listPullRequestComments(owner, repo, number, paged);
          },
        );
      },
      getComment: async (pull, comment) => {
        this.#assertIssue(pull, "pullRequests.getComment");
        assertInput(comment, { call: "pullRequests.getComment", shape: { commentId: "string" } });
        return this.getPullRequestComment(pull.owner, pull.repo, pull.number, comment.commentId);
      },
      createComment: async (pull, input) => {
        this.#assertIssue(pull, "pullRequests.createComment");
        assertCommentBody(input.body, this.#platform);
        return this.createPullRequestComment(pull.owner, pull.repo, pull.number, input);
      },
      listReactions: async (pull, options) => {
        this.#assertIssue(pull, "pullRequests.listReactions");
        const { owner, repo, number } = pull;
        return this.#paged(
          { listing: "pullRequests.listReactions", subject: [owner, repo, number], options },
          (paged) => {
            this.#assertListPage(paged);
            return this.listPullRequestReactions(owner, repo, number, paged);
          },
        );
      },
    };
    this.users = {
      get: (username) => this.getUser(username),
      authenticated: () => this.getAuthenticatedUser(),
    };
    this.threads = {
      list: async (pull, options) => {
        this.#assertIssue(pull, "threads.list");
        const { owner, repo, number } = pull;
        return this.#paged(
          { listing: "threads.list", subject: [owner, repo, number], options },
          (paged) => this.listThreads(owner, repo, number, paged),
        );
      },
      get: async (pull, thread) => {
        this.#assertIssue(pull, "threads.get");
        assertInput(thread, { call: "threads.get", shape: { threadId: "string" } });
        return this.getThread(pull.owner, pull.repo, pull.number, thread.threadId);
      },
      reply: async (pull, request) => {
        this.#assertIssue(pull, "threads.reply");
        assertInput(request, { call: "threads.reply", shape: { threadId: "string" } });
        const { threadId, ...input } = request;
        return this.replyToThread(pull.owner, pull.repo, pull.number, threadId, input);
      },
      resolve: async (pull, thread) => {
        this.#assertIssue(pull, "threads.resolve");
        assertInput(thread, { call: "threads.resolve", shape: { threadId: "string" } });
        return this.resolveThread(pull.owner, pull.repo, pull.number, thread.threadId);
      },
      unresolve: async (pull, thread) => {
        this.#assertIssue(pull, "threads.unresolve");
        assertInput(thread, { call: "threads.unresolve", shape: { threadId: "string" } });
        return this.unresolveThread(pull.owner, pull.repo, pull.number, thread.threadId);
      },
    };
  }

  /** Reads the page a cursor names and writes the next; URLs stay on {@link cursorOrigin}. */
  async #paged<O extends { cursor?: string }, R extends PageResult<unknown>>(
    source: Listing<O>,
    read: (positioned: Positioned<O>) => Promise<Continued<R> | Numbered<R>>,
  ): Promise<R> {
    const { listing, subject, options } = source;
    if (options !== undefined && Object.hasOwn(options, "page")) {
      throw this.#refusal("page is gone: pass the nextCursor of the previous page as cursor");
    }
    const { cursor, ...rest } = options ?? ({} as O);
    const scope = cursorScope([...subject, rest]);
    const at =
      cursor === undefined
        ? undefined
        : decodeCursor(cursor, {
            listing,
            origin: this.cursorOrigin(),
            platform: this.#platform,
            scope,
            key: this.cursorKey(),
          });
    const page = at !== undefined && "page" in at ? at.page : undefined;
    const positioned = {
      ...rest,
      ...(at ? { at } : {}),
      ...(page ? { page } : {}),
    } as Positioned<O>;
    const answer = (await read(positioned)) as Continued<R> & Partial<Numbered<R>>;
    const { next, hasNextPage, nextPage, ...result } = answer;
    const position: PagePosition | undefined =
      next ?? (hasNextPage ? { page: nextPage ?? (page ?? 1) + 1 } : undefined);
    if (position === undefined) return result as unknown as R;
    const nextCursor = encodeCursor(position, { listing, scope, key: this.cursorKey() });
    return { ...result, nextCursor } as unknown as R;
  }

  /** The key that signs URL cursors; none leaves them unsigned, fine when no token rides along. */
  protected cursorKey(): Uint8Array | undefined {
    return undefined;
  }

  /** The origin a next-page URL in a cursor must keep; none refuses URL cursors. */
  protected cursorOrigin(): string | undefined {
    return undefined;
  }

  /** A number of the right type can still be `NaN` or `1.5`, which no forge route takes. */
  #assertIssue(issue: IssueRef, call: string): void {
    assertIssueRef(issue, call);
    this.#assertPositive(issue.number, "Number");
  }

  #assertPositive(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw this.#refusal(`${field} must be a positive integer`);
    }
  }

  #refusal(message: string): ForgesError {
    return new ForgesError(message, { status: 400, platform: this.#platform });
  }

  #assertCheckPage(options: WithPage<ListPullRequestChecksOptions> | undefined): void {
    const page = paginationPageValue(options?.page, { ...PAGE, platform: this.#platform });
    const perPage = paginationPageValue(options?.perPage, {
      ...PER_PAGE,
      platform: this.#platform,
    });
    if (!Number.isSafeInteger(page * perPage + 1)) {
      throw this.#refusal("Check pagination exceeds the safe integer range");
    }
  }

  /** Gitea cuts discussions and comment reactions locally, where a zero page never ends. */
  #assertListPage(options: WithPage<ListCommentOptions> | undefined): void {
    paginationPageValue(options?.page, { ...PAGE, platform: this.#platform });
    paginationPageValue(options?.perPage, { ...PER_PAGE, platform: this.#platform });
  }

  /** An issue can't be its own child, so that call never needs the network to fail. */
  #assertSubIssue(issue: IssueRef, input: SubIssueInput, call: string): void {
    this.#assertIssue(issue, `issues.${call}`);
    assertInput(input, { call: `issues.${call}`, shape: { subIssue: "number" } });
    this.#assertPositive(input.subIssue, "Sub-issue");
    if (input.subIssue === issue.number) {
      throw this.#refusal(`Issue ${issue.number} cannot be a sub-issue of itself`);
    }
  }

  #unsupported(message: string): Promise<never> {
    return Promise.reject(new ForgesError(message, { status: 501, platform: this.#platform }));
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
    options?: Positioned<ListOptions>,
  ): Promise<ContinuedPage<Repository>>;
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
    _options?: Positioned<ListTagsOptions>,
  ): Promise<ContinuedPage<Tag>> {
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
    _options?: WithPage<CodeSearchOptions>,
  ): Promise<NumberedSearchPage<CodeSearchItem>> {
    return this.#unsupported("Code search is not supported by this provider");
  }
  protected listCiRuns(
    _owner: string,
    _repo: string,
    _options?: Positioned<ListCiRunsOptions>,
  ): Promise<ContinuedPage<CiRun>> {
    return this.#unsupported("CI-run listing is not supported by this provider");
  }
  protected listCiJobs(
    _owner: string,
    _repo: string,
    _runId: string,
    _options?: Positioned<ListCiJobsOptions>,
  ): Promise<ContinuedPage<CiJob>> {
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
    _options?: WithPage<GlobalPullRequestSearchOptions>,
  ): Promise<Numbered<GlobalPullRequestSearchResult>> {
    return this.#unsupported("Global pull-request search is not supported by this provider");
  }
  protected searchIssuesGlobal(
    _query: string,
    _options?: WithPage<GlobalIssueSearchOptions>,
  ): Promise<Numbered<GlobalIssueSearchResult>> {
    return this.#unsupported("Global issue search is not supported by this provider");
  }
  protected searchCommits(
    _query: string,
    _options?: WithPage<CommitSearchOptions>,
  ): Promise<Numbered<CommitSearchResult>> {
    return this.#unsupported("Commit search is not supported by this provider");
  }
  protected listCommits(
    _owner: string,
    _repo: string,
    _options?: Positioned<ListCommitOptions>,
  ): Promise<ContinuedPage<CommitSummary>> {
    return this.#unsupported("Commit listing is not supported by this provider");
  }
  protected abstract getCommit(owner: string, repo: string, sha: string): Promise<Commit>;
  protected listCommitChecks(
    _owner: string,
    _repo: string,
    _ref: string,
    _options?: WithPage<ListCommitChecksOptions>,
  ): Promise<NumberedPage<PullRequestCheck>> {
    return this.#unsupported("Commit checks are not supported by this provider");
  }
  protected compareCommits(
    _owner: string,
    _repo: string,
    _base: string,
    _head: string,
    _options?: WithPage<CompareCommitsOptions>,
  ): Promise<Numbered<CommitComparison>> {
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
    _options?: Positioned<ListReleasesOptions>,
  ): Promise<ContinuedPage<Release>> {
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
    options?: Positioned<ListOptions>,
  ): Promise<ContinuedPage<Issue>>;
  protected searchIssues(
    _owner: string,
    _repo: string,
    _query: string,
    _options?: WithPage<ListOptions>,
  ): Promise<NumberedSearchPage<Issue>> {
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
  /** A provider that counts pages reads `page`; one that follows the forge's own cursor reads `at`. */
  protected abstract listPullRequests(
    owner: string,
    repo: string,
    options?: Positioned<ListOptions>,
  ): Promise<NumberedPage<PullRequest> | ContinuedPage<PullRequest>>;
  protected listPullRequestFiles(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: Positioned<ListPullRequestFilesOptions>,
  ): Promise<ContinuedPage<PullRequestFile>> {
    return this.#unsupported("Pull request file listing is not supported by this provider");
  }
  protected listPullRequestChecks(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: WithPage<ListPullRequestChecksOptions>,
  ): Promise<NumberedPage<PullRequestCheck>> {
    return this.#unsupported("Pull request checks are not supported by this provider");
  }
  protected listPullRequestReviews(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: WithPage<ListPullRequestReviewsOptions>,
  ): Promise<NumberedPage<PullRequestReview>> {
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
    _options?: WithPage<ListOptions>,
  ): Promise<NumberedSearchPage<PullRequestSearchItem>> {
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
    options?: Positioned<ListCommentOptions>,
  ): Promise<ContinuedPage<Comment>>;
  protected abstract listPullRequestComments(
    owner: string,
    repo: string,
    number: number,
    options?: Positioned<ListCommentOptions>,
  ): Promise<ContinuedPage<Comment>>;
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
    _options?: WithPage<ListReactionOptions>,
  ): Promise<NumberedPage<Reaction>> {
    return this.#unsupported("Issue reactions are not supported by this provider");
  }
  protected listSubIssues(
    _issue: IssueRef,
    _options?: WithPage<ListCommentOptions>,
  ): Promise<NumberedPage<SubIssue>> {
    return this.#unsupported("Sub-issues are not supported by this provider");
  }
  protected addSubIssue(_issue: IssueRef, _input: AddSubIssueInput): Promise<Issue> {
    return this.#unsupported("Sub-issues are not supported by this provider");
  }
  protected removeSubIssue(_issue: IssueRef, _input: SubIssueInput): Promise<Issue> {
    return this.#unsupported("Sub-issues are not supported by this provider");
  }
  protected listPullRequestReactions(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: WithPage<ListReactionOptions>,
  ): Promise<NumberedPage<Reaction>> {
    return this.#unsupported("Pull request reactions are not supported by this provider");
  }
  protected abstract getUser(username: string): Promise<User>;
  protected abstract getAuthenticatedUser(): Promise<User>;
  protected abstract listThreads(
    owner: string,
    repo: string,
    number: number,
    options?: WithPage<ListThreadOptions>,
  ): Promise<NumberedPage<Thread>>;
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

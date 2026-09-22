/**
 * GitHub provider implementation
 * Also serves GitBucket (GitHub API v3 compatible) via custom baseURL
 */

import { Buffer } from "node:buffer";
import { Provider, type ProviderRawTypes } from "../provider.ts";
import type {
  ProviderConfig,
  Repository,
  RepositoryContents,
  RepositoryContentsOptions,
  CodeSearchItem,
  CodeSearchOptions,
  CiRun,
  Commit,
  CommitPatch,
  CommitPatchFile,
  CommitPatchOptions,
  CommitSummary,
  CommitSearchOptions,
  CommitSearchResult,
  ContributionTemplateKind,
  ContributionTemplateSummary,
  Issue,
  PullRequest,
  ClosingIssue,
  PullRequestCheck,
  PullRequestReview,
  PullRequestFile,
  PullRequestSearchItem,
  GlobalPullRequestSearchOptions,
  GlobalPullRequestSearchResult,
  GlobalPullRequestSearchItem,
  User,
  Owner,
  PageResult,
  SearchPageResult,
  ListOptions,
  ListCiRunsOptions,
  ListCommentOptions,
  ListCommitOptions,
  ListPullRequestChecksOptions,
  ListPullRequestReviewsOptions,
  ListPullRequestFilesOptions,
  ListThreadOptions,
  Comment,
  CreateIssueInput,
  CreatePullRequestInput,
  CreateReleaseInput,
  IssueState,
  ListReleasesOptions,
  Release,
  ReplyThreadInput,
  Thread,
  ThreadComment,
  UpdateReleaseInput,
} from "../types.ts";
import { FetchError } from "ofetch";
import { ForgesError, NotFoundError, normalizeError } from "../errors.ts";
import { createHttpClient, rawFetch, type HttpClient, type RawFetchResult } from "../http.ts";
import { parseLinkHeader } from "../pagination.ts";
import {
  encodeApiResponsePathSegment,
  encodePathSegment,
  encodeRefPathSegment,
} from "./base-url.ts";
import { mapBooleanRepositoryPermission } from "../repository-access.ts";
import { normalizeCiRunState } from "../ci-run.ts";
import { isPullRequestReview, normalizeReviewState } from "../review.ts";
import { normalizeChangedFileStatus } from "../changed-file.ts";
import { buildCommitPatch } from "../commit-patch.ts";
import {
  assertContinuationRef,
  assertFileSize,
  buildRepositoryFile,
  contentsEntryType,
  encodeRepositoryPath,
  fileTooLarge,
  isCommitSha,
  unreadableEntry,
} from "../repository-contents.ts";

const MAX_COMMIT_FILE_PAGES = 30;
const MAX_DRAFT_RELEASE_PAGES = 5;
/** GitHub lists at most this many entries of one directory through the contents API. */
const GITHUB_DIRECTORY_ENTRY_LIMIT = 1000;
const GITHUB_SEARCH_RESULT_LIMIT = 1000;
const GITHUB_ISSUE_TEMPLATE_DIRECTORY = ".github/ISSUE_TEMPLATE";
const GITHUB_COMMUNITY_FILE_DIRECTORIES = [".github", "", "docs"] as const;

// --- GitHub API response types (snake_case) ---

interface GitHubOwner {
  login: string;
  avatar_url: string;
}

interface GitHubRepositoryParent {
  full_name: string;
  html_url: string;
}

interface GitHubCodeSearchItem {
  path: string;
  html_url: string;
  repository: {
    full_name: string;
  };
}

interface GitHubCodeSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubCodeSearchItem[];
}

interface GitHubContent {
  type: string;
  name: string;
  path: string;
  size?: number;
  content?: string;
  encoding?: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  visibility?: string;
  default_branch: string;
  html_url: string;
  clone_url: string;
  fork: boolean;
  parent?: GitHubRepositoryParent | null;
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    triage?: boolean;
    pull?: boolean;
  } | null;
  owner: GitHubOwner;
}

/**
 * The profile fields are optional because GitBucket's GitHub-compatible
 * payload omits them.
 */
interface GitHubCiRun {
  id: number;
  head_branch: string | null;
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

interface GitHubCiRunsResponse {
  total_count: number;
  workflow_runs: GitHubCiRun[];
}

interface GitHubCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

interface GitHubCheckRunsResponse {
  total_count: number;
  check_runs: GitHubCheckRun[];
}

interface GitHubCommitStatus {
  id: number;
  context: string;
  state: string;
  target_url: string | null;
}

interface GitHubCombinedStatus {
  total_count: number;
  statuses: GitHubCommitStatus[];
}

interface GitHubPullRequestReview {
  id: number;
  user: { login: string } | null;
  body: string | null;
  state: string;
  html_url: string;
  commit_id: string | null;
  submitted_at?: string | null;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  site_admin: boolean;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  blog?: string | null;
  followers?: number;
  following?: number;
  created_at?: string;
  html_url?: string;
}

interface GitHubLabel {
  name: string;
}

interface GitHubPullRequestSearchMetadata {
  merged_at?: string | null;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: GitHubLabel[];
  user: { login: string } | null;
  assignees?: Array<{ login: string }> | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  repository_url?: string;
  pull_request?: GitHubPullRequestSearchMetadata;
  draft?: boolean;
}

interface GitHubIssueSearchResponse {
  total_count?: number;
  items: GitHubIssue[];
  incomplete_results: boolean;
}

interface GitHubPullRequest extends GitHubIssue {
  head: { ref: string; sha?: string | null };
  base: { ref: string };
  merged?: boolean;
  merged_at?: string | null;
  merged_by?: { login: string } | null;
  draft: boolean;
  merge_commit_sha?: string | null;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
}

interface GitHubPullRequestFile {
  filename: string;
  status: string;
  additions?: number;
  deletions?: number;
  previous_filename?: string;
  patch?: string;
}

interface GitHubCommitIdentity {
  name: string;
  email: string;
  date: string;
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: GitHubCommitIdentity;
    committer: GitHubCommitIdentity;
  };
  html_url: string;
  parents: Array<{ sha: string }>;
  files?: GitHubPullRequestFile[];
}

interface GitHubCommitSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: Array<GitHubCommit & { repository: { full_name: string } }>;
}

interface GitHubComment {
  id: number;
  body: string | null;
  user: { login: string } | null;
  html_url: string;
  issue_url?: string | null;
  created_at: string;
  updated_at: string;
}

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  author: { login: string } | null;
  created_at: string;
  published_at: string | null;
  html_url: string;
}

interface GitHubRawTypes extends ProviderRawTypes {
  owner: GitHubOwner;
  repository: GitHubRepo;
  issue: GitHubIssue;
  pullRequest: GitHubPullRequest;
  user: GitHubUser;
  thread: GitHubGraphQLReviewThread;
  comment: GitHubComment;
}

interface GitHubReviewComment {
  id: number;
  body: string;
  user: { login: string } | null;
  html_url: string;
  created_at: string;
}

interface GitHubGraphQLPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GitHubGraphQLReviewComment {
  databaseId: number | null;
  fullDatabaseId: string | number | null;
  body: string;
  url: string;
  createdAt: string;
  author: { login: string } | null;
}

interface GitHubGraphQLCommentConnection {
  pageInfo: GitHubGraphQLPageInfo;
  nodes: Array<GitHubGraphQLReviewComment | null> | null;
}

interface GitHubGraphQLThreadScope {
  number: number;
  repository: { name: string; owner: { login: string } } | null;
}

interface GitHubGraphQLReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  startLine: number | null;
  pullRequest: GitHubGraphQLThreadScope | null;
  comments: GitHubGraphQLCommentConnection;
}

interface GitHubGraphQLError {
  message: string;
  type?: string;
}

interface GitHubGraphQLResponse<T> {
  data?: T | null;
  errors?: GitHubGraphQLError[];
}

interface GitHubGraphQLThreadListData {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: GitHubGraphQLPageInfo;
        nodes: Array<GitHubGraphQLReviewThread | null> | null;
      };
    } | null;
  } | null;
}

interface GitHubGraphQLThreadNodeData {
  node: GitHubGraphQLReviewThread | null;
}

interface GitHubGraphQLThreadScopeData {
  node: { pullRequest: GitHubGraphQLThreadScope | null } | null;
}

interface GitHubGraphQLClosingIssue {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  url: string;
}

interface GitHubGraphQLClosingIssuesData {
  repository: {
    pullRequest: {
      closingIssuesReferences: {
        pageInfo: GitHubGraphQLPageInfo;
        nodes: Array<GitHubGraphQLClosingIssue | null> | null;
      };
    } | null;
  } | null;
}

interface GitHubGraphQLThreadMutationData {
  resolveReviewThread?: { thread: GitHubGraphQLReviewThread | null };
  unresolveReviewThread?: { thread: GitHubGraphQLReviewThread | null };
}

const THREAD_SCOPE_FIELDS = `
  pullRequest {
    number
    repository { name owner { login } }
  }
`;

const THREAD_FIELDS = `
  id
  isResolved
  isOutdated
  path
  line
  startLine
  ${THREAD_SCOPE_FIELDS}
  comments(first: 100, after: $commentsAfter) {
    pageInfo { hasNextPage endCursor }
    nodes { databaseId fullDatabaseId body url createdAt author { login } }
  }
`;

const LIST_THREADS_QUERY = `
  query($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String, $commentsAfter: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ${THREAD_FIELDS} }
        }
      }
    }
  }
`;

const GET_THREAD_QUERY = `
  query($id: ID!, $commentsAfter: String) {
    node(id: $id) {
      ... on PullRequestReviewThread { ${THREAD_FIELDS} }
    }
  }
`;

const THREAD_SCOPE_QUERY = `
  query($id: ID!) {
    node(id: $id) {
      ... on PullRequestReviewThread { ${THREAD_SCOPE_FIELDS} }
    }
  }
`;

const CLOSING_ISSUES_QUERY = `
  query($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        closingIssuesReferences(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { number title state url }
        }
      }
    }
  }
`;

const RESOLVE_THREAD_MUTATION = `
  mutation($id: ID!, $commentsAfter: String) {
    resolveReviewThread(input: {threadId: $id}) {
      thread { ${THREAD_FIELDS} }
    }
  }
`;

const UNRESOLVE_THREAD_MUTATION = `
  mutation($id: ID!, $commentsAfter: String) {
    unresolveReviewThread(input: {threadId: $id}) {
      thread { ${THREAD_FIELDS} }
    }
  }
`;

function githubGraphqlUrl(restBaseURL: string): string {
  const base = restBaseURL.replace(/\/+$/, "");
  if (base.endsWith("/api/v3")) {
    return `${base.slice(0, -"/api/v3".length)}/api/graphql`;
  }
  return "/graphql";
}

/**
 * A review-thread node id is globally unique, so a stale or mismatched id would
 * otherwise read or mutate a thread on a different pull request.
 */
function threadMatchesPullRequest(
  scope: GitHubGraphQLThreadScope | null | undefined,
  owner: string,
  repo: string,
  number: number,
): boolean {
  const repository = scope?.repository;
  if (!repository) {
    return false;
  }
  return (
    scope.number === number &&
    repository.name.toLowerCase() === repo.toLowerCase() &&
    repository.owner.login.toLowerCase() === owner.toLowerCase()
  );
}

/**
 * GraphQL `Int` cannot hold the newer 64-bit comment ids, so `databaseId` comes
 * back null for them while `fullDatabaseId` (a BigInt, serialized as a string)
 * still carries the value. It stays a string all the way into the REST reply
 * URL, because `Number()` would lose precision on exactly those ids.
 */
function reviewCommentId(comment: GitHubGraphQLReviewComment): string {
  const id = comment.fullDatabaseId ?? comment.databaseId;
  return id === null || id === undefined ? "" : String(id);
}

function presentGraphQLNodes<T>(nodes: Array<T | null> | null | undefined): T[] {
  return (nodes ?? []).filter((node): node is T => node !== null);
}

// --- Pagination helper ---

function paginationFromLink(headers: Headers): {
  hasNextPage: boolean;
  nextPage: number | undefined;
} {
  const next = parseLinkHeader(headers.get("Link")).next;
  if (!next) return { hasNextPage: false, nextPage: undefined };
  const page = new URL(next, "https://forges.invalid").searchParams.get("page");
  if (page === null) return { hasNextPage: true, nextPage: undefined };
  const parsed = parseInt(page, 10);
  return {
    hasNextPage: true,
    nextPage: Number.isInteger(parsed) && parsed > 0 ? parsed : undefined,
  };
}

function githubSearchQualifierSegment(value: string): string {
  try {
    encodePathSegment(value);
    if (/[\s:'"]/u.test(value)) {
      throw new TypeError("Invalid GitHub search qualifier segment");
    }
    return value;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new ForgesError(error.message, 400, "github", error);
  }
}

function buildPageResult<TRaw, TMapped>(
  items: TRaw[],
  headers: Headers,
  mapper: (raw: TRaw) => TMapped,
): PageResult<TMapped> {
  const { hasNextPage, nextPage } = paginationFromLink(headers);
  return {
    items: items.map(mapper),
    hasNextPage,
    nextPage,
  };
}

// --- Provider ---

export class GitHubProvider extends Provider<GitHubRawTypes> {
  private client: HttpClient;
  private readonly restBaseURL: string;
  private readonly authenticated: boolean;
  private gitHubHost: boolean | undefined;

  constructor(config: ProviderConfig) {
    super();
    this.restBaseURL = config.baseURL || "https://api.github.com";
    const token = config.token ?? "";
    this.authenticated = token !== "";
    this.client = createHttpClient({
      baseURL: this.restBaseURL,
      token,
      tokenHeader: "Authorization",
      tokenPrefix: "token ",
    });
  }

  /**
   * An empty token names no viewer, so anonymous reads skip the lookup. An
   * installation token has no viewer either: GitHub refuses /user for it with
   * 403 while the public repository routes still answer, so that refusal
   * means "not the viewer" rather than a failed listing.
   */
  private async isViewer(owner: string): Promise<boolean> {
    if (!this.authenticated) return false;
    try {
      const viewer = await this.getAuthenticatedUser();
      return viewer.login.toLowerCase() === owner.toLowerCase();
    } catch (error) {
      const normalized = normalizeError(error, "github");
      if (normalized.status === 403) return false;
      throw normalized;
    }
  }

  private repositoryRoute(fullName: string): string {
    const segments = fullName.split("/");
    const owner = segments[0];
    const repo = segments[1];
    if (segments.length !== 2 || owner === undefined || repo === undefined) {
      throw new ForgesError("GitHub returned an invalid repository name", 502, "github");
    }
    return `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`;
  }

  private contentsRoute(fullName: string, path: string): string {
    const encodedPath =
      path === "" ? "" : path.split("/").map(encodeApiResponsePathSegment).join("/");
    const suffix = encodedPath === "" ? "" : `/${encodedPath}`;
    return `${this.repositoryRoute(fullName)}/contents${suffix}`;
  }

  private async tryRepository(owner: string, repo: string): Promise<GitHubRepo | null> {
    try {
      return await this.client<GitHubRepo>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`,
      );
    } catch (error) {
      const normalized = normalizeError(error, "github");
      if (normalized.status === 404) return null;
      throw normalized;
    }
  }

  /** GitHub.com and Enterprise serve the whole API, GitBucket and the like do not. Probed once per instance. */
  private async isGitHubHost(owner: string, repo: string): Promise<boolean> {
    if (this.gitHubHost !== undefined) return this.gitHubHost;
    const hostname = new URL(this.restBaseURL).hostname;
    if (hostname === "api.github.com" || hostname.endsWith(".ghe.com")) return true;
    try {
      const { headers } = await rawFetch<GitHubRepo>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`,
      );
      this.gitHubHost = headers.has("x-github-enterprise-version");
      return this.gitHubHost;
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  private async tryListContents(
    fullName: string,
    path: string,
    ref: string,
  ): Promise<GitHubContent[]> {
    try {
      const contents = await this.client<GitHubContent[] | GitHubContent>(
        this.contentsRoute(fullName, path),
        { query: { ref } },
      );
      return Array.isArray(contents) ? contents : [];
    } catch (error) {
      const normalized = normalizeError(error, "github");
      if (normalized.status === 404) return [];
      throw normalized;
    }
  }

  private templateSummary(
    kind: ContributionTemplateKind,
    sourceRepository: string,
    sourceRef: string,
    file: GitHubContent,
    inherited: boolean,
  ): ContributionTemplateSummary {
    const name = file.name.replace(/\.[^.]+$/u, "");
    return {
      kind,
      key: `${sourceRepository}:${file.path}`,
      name,
      scope: inherited ? "owner" : "repository",
      inherited,
      sourceRepository,
      sourcePath: file.path,
      sourceRef,
    };
  }

  private async discoverIssueTemplates(
    repository: GitHubRepo,
    inherited: boolean,
  ): Promise<{ templates: ContributionTemplateSummary[]; overrides: boolean }> {
    const entries = await this.tryListContents(
      repository.full_name,
      GITHUB_ISSUE_TEMPLATE_DIRECTORY,
      repository.default_branch,
    );
    const files = entries.filter(
      (entry) =>
        entry.type === "file" &&
        !/^config\.ya?ml$/iu.test(entry.name) &&
        /\.(?:md|ya?ml)$/iu.test(entry.name),
    );
    const hasConfiguration = entries.some(
      (entry) => entry.type === "file" && /^config\.ya?ml$/iu.test(entry.name),
    );
    if (files.length > 0 || hasConfiguration) {
      return {
        templates: files.map((file) =>
          this.templateSummary(
            "issue",
            repository.full_name,
            repository.default_branch,
            file,
            inherited,
          ),
        ),
        overrides: true,
      };
    }

    const listings = await Promise.all(
      GITHUB_COMMUNITY_FILE_DIRECTORIES.map((location) =>
        this.tryListContents(repository.full_name, location, repository.default_branch),
      ),
    );
    const singular = listings
      .flatMap((listing) =>
        listing.filter(
          (entry) => entry.type === "file" && /^issue_template(?:\.[^/]+)?$/iu.test(entry.name),
        ),
      )
      .at(0);
    return {
      templates:
        singular === undefined
          ? []
          : [
              this.templateSummary(
                "issue",
                repository.full_name,
                repository.default_branch,
                singular,
                inherited,
              ),
            ],
      overrides: singular !== undefined,
    };
  }

  private async discoverPullRequestTemplates(
    repository: GitHubRepo,
    inherited: boolean,
  ): Promise<{ templates: ContributionTemplateSummary[]; overrides: boolean }> {
    const baseEntries = await Promise.all(
      GITHUB_COMMUNITY_FILE_DIRECTORIES.map((location) =>
        this.tryListContents(repository.full_name, location, repository.default_branch),
      ),
    );
    const templateDirectories = await Promise.all(
      GITHUB_COMMUNITY_FILE_DIRECTORIES.map((location) => {
        const path =
          location === "" ? "PULL_REQUEST_TEMPLATE" : `${location}/PULL_REQUEST_TEMPLATE`;
        return this.tryListContents(repository.full_name, path, repository.default_branch);
      }),
    );
    const singular = baseEntries
      .flatMap((entries) =>
        entries.filter(
          (entry) =>
            entry.type === "file" && /^pull_request_template(?:\.[^/]+)?$/iu.test(entry.name),
        ),
      )
      .at(0);
    const seenNames = new Set<string>();
    const selectable = templateDirectories.flatMap((entries) =>
      entries.filter((entry) => {
        if (entry.type !== "file") return false;
        const name = entry.name.toLowerCase();
        if (seenNames.has(name)) return false;
        seenNames.add(name);
        return true;
      }),
    );
    const files = singular === undefined ? selectable : [singular, ...selectable];
    return {
      templates: files.map((file) =>
        this.templateSummary(
          "pull_request",
          repository.full_name,
          repository.default_branch,
          file,
          inherited,
        ),
      ),
      overrides:
        singular !== undefined || templateDirectories.some((entries) => entries.length > 0),
    };
  }

  protected override async listContributionTemplates(
    owner: string,
    repo: string,
    kind: ContributionTemplateKind,
  ): Promise<ContributionTemplateSummary[]> {
    try {
      const repository = await this.client<GitHubRepo>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`,
      );
      const local =
        kind === "issue"
          ? await this.discoverIssueTemplates(repository, false)
          : await this.discoverPullRequestTemplates(repository, false);
      if (local.overrides || repository.name.toLowerCase() === ".github") {
        return local.templates;
      }
      if (!(await this.isGitHubHost(owner, repo))) return local.templates;

      const defaults = await this.tryRepository(owner, ".github");
      const usableDefaults =
        defaults !== null && (!defaults.private || defaults.visibility === "internal");
      if (!usableDefaults) return local.templates;
      const inherited =
        kind === "issue"
          ? await this.discoverIssueTemplates(defaults, true)
          : await this.discoverPullRequestTemplates(defaults, true);
      return inherited.templates;
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async readContributionTemplate(
    _owner: string,
    _repo: string,
    template: ContributionTemplateSummary,
  ): Promise<string> {
    try {
      if (
        template.sourceRepository === null ||
        template.sourcePath === null ||
        template.sourceRef === null
      ) {
        throw new ForgesError("GitHub template source metadata is incomplete", 502, "github");
      }
      const file = await this.client<GitHubContent>(
        this.contentsRoute(template.sourceRepository, template.sourcePath),
        { query: { ref: template.sourceRef } },
      );
      if (file.type !== "file" || file.encoding !== "base64" || file.content === undefined) {
        throw new ForgesError("GitHub did not return decodable template content", 502, "github");
      }
      return Buffer.from(file.content.replaceAll("\n", ""), "base64").toString("utf8");
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override mapOwner(raw: GitHubOwner): Owner {
    return {
      login: raw.login,
      avatarUrl: raw.avatar_url,
    };
  }

  protected override mapRepository(raw: GitHubRepo): Repository {
    return {
      id: String(raw.id),
      name: raw.name,
      fullName: raw.full_name,
      description: raw.description ?? "",
      private: raw.private,
      defaultBranch: raw.default_branch,
      url: raw.html_url,
      cloneUrl: raw.clone_url,
      isFork: raw.fork,
      parent: raw.parent ? { fullName: raw.parent.full_name, url: raw.parent.html_url } : null,
      viewerPermission: mapBooleanRepositoryPermission(raw.permissions),
      owner: this.mapOwner(raw.owner),
    };
  }

  private mapCiRun(raw: GitHubCiRun): CiRun {
    return {
      id: String(raw.id),
      branch: raw.head_branch ?? "",
      revision: raw.head_sha,
      ...normalizeCiRunState(raw.status, raw.conclusion),
      url: raw.html_url,
    };
  }

  private mapCommitSummary(raw: GitHubCommit): CommitSummary {
    return {
      sha: raw.sha,
      message: raw.commit.message,
      author: raw.commit.author,
      committer: raw.commit.committer,
      parents: raw.parents.map((parent) => parent.sha),
      url: raw.html_url,
    };
  }

  private mapPullRequestCheck(raw: GitHubCheckRun): PullRequestCheck {
    return {
      id: String(raw.id),
      name: raw.name,
      ...normalizeCiRunState(raw.status, raw.conclusion),
      url: raw.html_url,
    };
  }

  /** `target_url` is the page a status links, if any. Its `url` is only the API route. */
  private mapCommitStatus(raw: GitHubCommitStatus): PullRequestCheck {
    return {
      id: String(raw.id),
      name: raw.context,
      ...normalizeCiRunState(raw.state),
      url: raw.target_url ?? "",
    };
  }

  private mapPullRequestReview(raw: GitHubPullRequestReview): PullRequestReview | null {
    const state = normalizeReviewState(raw.state);
    if (state === null) return null;
    return {
      id: String(raw.id),
      state,
      body: raw.body ?? "",
      author: { login: raw.user?.login ?? "" },
      revision: raw.commit_id ?? "",
      submittedAt: raw.submitted_at ?? "",
      url: raw.html_url,
    };
  }

  private mapPullRequestFile(raw: GitHubPullRequestFile): PullRequestFile {
    return {
      path: raw.filename,
      status: normalizeChangedFileStatus(raw.status),
      additions: raw.additions ?? null,
      deletions: raw.deletions ?? null,
    };
  }

  private mapRelease(raw: GitHubRelease): Release {
    return {
      id: String(raw.id),
      tag: raw.tag_name,
      name: raw.name ?? "",
      body: raw.body ?? "",
      draft: raw.draft,
      prerelease: raw.prerelease,
      author: { login: raw.author?.login ?? "" },
      createdAt: raw.created_at,
      publishedAt: raw.published_at ?? "",
      url: raw.html_url,
    };
  }

  protected override mapIssue(raw: GitHubIssue): Issue {
    return {
      id: String(raw.id),
      number: raw.number,
      title: raw.title,
      body: raw.body ?? "",
      state: raw.state as IssueState,
      labels: raw.labels.map((label) => label.name),
      author: { login: raw.user?.login ?? "" },
      assignees: (raw.assignees ?? []).map(({ login }) => ({ login })),
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      url: raw.html_url,
    };
  }

  private mapPullRequestSearchItem(raw: GitHubIssue): PullRequestSearchItem {
    return {
      ...this.mapIssue(raw),
      merged: raw.pull_request?.merged_at != null,
      draft: raw.draft ?? false,
    };
  }

  protected override mapPullRequest(raw: GitHubPullRequest): PullRequest {
    const merged = raw.merged ?? raw.merged_at != null;
    return {
      ...this.mapPullRequestSearchItem(raw),
      sourceBranch: raw.head.ref,
      targetBranch: raw.base.ref,
      merged,
      draft: raw.draft,
      mergeCommitSha: merged ? (raw.merge_commit_sha ?? "") : "",
      mergedAt: merged ? (raw.merged_at ?? null) : null,
      mergedBy: merged && raw.merged_by ? { login: raw.merged_by.login } : null,
      headSha: raw.head.sha ?? "",
      mergeable: raw.mergeable ?? null,
      mergeStatus: raw.mergeable_state ?? "",
    };
  }

  protected override mapUser(raw: GitHubUser): User {
    return {
      id: String(raw.id),
      login: raw.login,
      name: raw.name ?? "",
      email: raw.email ?? "",
      avatarUrl: raw.avatar_url,
      isAdmin: raw.site_admin,
      bio: raw.bio ?? "",
      company: raw.company ?? "",
      location: raw.location ?? "",
      website: raw.blog ?? "",
      followers: raw.followers ?? 0,
      following: raw.following ?? 0,
      createdAt: raw.created_at ?? "",
      url: raw.html_url ?? "",
    };
  }

  protected override mapComment(raw: GitHubComment): Comment {
    return {
      id: String(raw.id),
      body: raw.body ?? "",
      author: { login: raw.user?.login ?? "" },
      url: raw.html_url,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  }

  protected override mapThread(raw: GitHubGraphQLReviewThread): Thread {
    return {
      id: raw.id,
      isResolved: raw.isResolved,
      isOutdated: raw.isOutdated,
      path: raw.path ?? "",
      line: raw.line,
      startLine: raw.startLine,
      comments: presentGraphQLNodes(raw.comments.nodes).map((comment) => ({
        id: reviewCommentId(comment),
        body: comment.body,
        author: { login: comment.author?.login ?? "" },
        url: comment.url,
        createdAt: comment.createdAt,
      })),
    };
  }

  // --- Repos ---

  /**
   * /users/{owner}/repos answers for organizations too, but only with their
   * public repositories, so the organization route has to go first. It
   * returns 404 for regular users, which selects the user route. That route
   * is public-only as well, even when the owner is the viewer, so the
   * viewer's own inventory comes from /user/repos, which carries the private
   * repositories too.
   */
  protected override async listRepos(
    owner: string,
    options?: ListOptions,
  ): Promise<PageResult<Repository>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);

      let response: RawFetchResult<GitHubRepo[]>;
      try {
        response = await rawFetch<GitHubRepo[]>(
          this.client,
          `/orgs/${encodePathSegment(owner)}/repos`,
          { query },
        );
      } catch (error) {
        const normalized = normalizeError(error, "github");
        if (normalized.status !== 404) {
          throw normalized;
        }

        response = (await this.isViewer(owner))
          ? await rawFetch<GitHubRepo[]>(this.client, "/user/repos", {
              query: { ...query, affiliation: "owner" },
            })
          : await rawFetch<GitHubRepo[]>(this.client, `/users/${encodePathSegment(owner)}/repos`, {
              query,
            });
      }

      return buildPageResult(response.data ?? [], response.headers, (raw) =>
        this.mapRepository(raw),
      );
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async getRepo(owner: string, repo: string): Promise<Repository> {
    try {
      const data = await this.client<GitHubRepo>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`,
      );
      return this.mapRepository(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async readRepositoryContents(
    owner: string,
    repo: string,
    path: string,
    options?: RepositoryContentsOptions,
  ): Promise<RepositoryContents> {
    try {
      const route = `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`;
      const sha = isCommitSha(options?.ref)
        ? options.ref
        : await this.resolveCommitSha(route, options?.ref ?? "HEAD");
      assertContinuationRef(options, sha);
      const contents = await this.client<GitHubContent[] | GitHubContent>(
        `${route}/contents${path === "" ? "" : `/${encodeRepositoryPath(path)}`}`,
        { query: { ref: sha } },
      );
      if (Array.isArray(contents)) {
        return {
          type: "directory",
          path,
          sha,
          entries: contents.map((entry) => ({
            name: entry.name,
            path: entry.path,
            type: contentsEntryType(entry.type),
            size: entry.type === "file" ? (entry.size ?? null) : null,
          })),
          entriesComplete: contents.length < GITHUB_DIRECTORY_ENTRY_LIMIT ? true : null,
        };
      }
      if (contents.type !== "file") throw unreadableEntry(path, contents.type);
      if (contents.encoding === "none") throw fileTooLarge(path, contents.size ?? 0);
      assertFileSize(path, contents.size ?? 0);
      if (contents.encoding !== "base64" || contents.content === undefined) {
        throw new ForgesError(`GitHub returned no content for ${path}`, 502, "github");
      }
      return buildRepositoryFile(path, sha, contents.content, options);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  /** Resolve a ref to a commit SHA; GitBucket ignores the sha media type and sends the commit. */
  private async resolveCommitSha(route: string, ref: string): Promise<string> {
    const body = await this.client<string, "text">(
      `${route}/commits/${encodeRefPathSegment(ref)}`,
      {
        headers: { Accept: "application/vnd.github.sha" },
        responseType: "text",
      },
    );
    const sha = body.trim();
    if (isCommitSha(sha)) return sha;
    try {
      const parsed: unknown = JSON.parse(sha);
      if (typeof parsed === "object" && parsed !== null && "sha" in parsed) {
        const { sha: parsedSha } = parsed;
        if (typeof parsedSha === "string" && isCommitSha(parsedSha)) return parsedSha;
      }
    } catch {
      /* Neither a SHA nor JSON: the error below says so. */
    }
    throw new ForgesError(`GitHub could not resolve ${ref} to a commit`, 502, "github");
  }

  protected override async listCiRuns(
    owner: string,
    repo: string,
    options?: ListCiRunsOptions,
  ): Promise<PageResult<CiRun>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);
      if (options?.branch) query.branch = options.branch;

      const { data, headers } = await rawFetch<GitHubCiRunsResponse>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/actions/runs`,
        { query },
      );
      return {
        ...buildPageResult(data?.workflow_runs ?? [], headers, (raw) => this.mapCiRun(raw)),
        totalCount: data?.total_count,
      };
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async searchCommits(
    searchQuery: string,
    options?: CommitSearchOptions,
  ): Promise<CommitSearchResult> {
    try {
      const page = options?.page ?? 1;
      const perPage = options?.perPage ?? 30;
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        !Number.isSafeInteger(perPage) ||
        perPage < 1 ||
        perPage > 100
      ) {
        throw new ForgesError(
          "Commit search requires a positive page and perPage from 1 to 100",
          400,
        );
      }
      const offset = (page - 1) * perPage;
      if (offset >= GITHUB_SEARCH_RESULT_LIMIT) {
        throw new ForgesError("GitHub commit search only exposes the first 1000 results", 400);
      }
      let query = searchQuery;
      if (options?.owner !== undefined) {
        const owner = githubSearchQualifierSegment(options.owner);
        query +=
          options.repo === undefined
            ? ` user:${owner}`
            : ` repo:${owner}/${githubSearchQualifierSegment(options.repo)}`;
      }
      const { data, headers } = await rawFetch<GitHubCommitSearchResponse>(
        this.client,
        "/search/commits",
        { query: { q: query, page: String(page), per_page: String(perPage) } },
      );
      const rawItems = data?.items ?? [];
      const expectedOwner = options?.owner?.toLowerCase();
      const expectedRepository =
        options?.repo === undefined ? undefined : `${options.owner}/${options.repo}`.toLowerCase();
      const scopedItems = rawItems.slice(0, GITHUB_SEARCH_RESULT_LIMIT - offset).filter((item) => {
        const repository = item.repository.full_name.toLowerCase();
        if (expectedRepository !== undefined) return repository === expectedRepository;
        return expectedOwner === undefined || repository.startsWith(`${expectedOwner}/`);
      });
      const result = buildPageResult(scopedItems, headers, (raw) => ({
        ...this.mapCommitSummary(raw),
        repository: raw.repository.full_name,
      }));
      if (page * perPage >= GITHUB_SEARCH_RESULT_LIMIT) {
        result.hasNextPage = false;
        delete result.nextPage;
      }
      return {
        ...result,
        totalCount: data?.total_count,
        incomplete:
          (data?.incomplete_results ?? false) ||
          (data?.total_count ?? 0) > GITHUB_SEARCH_RESULT_LIMIT ||
          scopedItems.length !== rawItems.length,
        resultLimit: GITHUB_SEARCH_RESULT_LIMIT,
      };
    } catch (error) {
      if (error instanceof FetchError && (error.status === 404 || error.status === 405)) {
        throw new ForgesError(
          "Commit search is not supported by this GitHub-compatible host",
          501,
          "github",
          error,
        );
      }
      throw normalizeError(error, "github");
    }
  }

  protected override async listCommits(
    owner: string,
    repo: string,
    options?: ListCommitOptions,
  ): Promise<PageResult<CommitSummary>> {
    try {
      const query: Record<string, string> = {};
      if (options?.ref) query.sha = options.ref;
      if (options?.path) query.path = options.path;
      if (options?.since) query.since = options.since;
      if (options?.until) query.until = options.until;
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);

      const { data, headers } = await rawFetch<GitHubCommit[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/commits`,
        { query },
      );
      return buildPageResult(data ?? [], headers, (raw) => this.mapCommitSummary(raw));
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async getCommit(owner: string, repo: string, sha: string): Promise<Commit> {
    try {
      const path = `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/commits/${encodePathSegment(sha)}`;
      const files: PullRequestFile[] = [];
      let commit: GitHubCommit | undefined;
      let filesComplete: boolean | null = true;
      let page = 1;

      while (page <= MAX_COMMIT_FILE_PAGES) {
        const { data, headers } = await rawFetch<GitHubCommit>(this.client, path, {
          query: { page: String(page), per_page: "100" },
        });
        if (!data) {
          throw new ForgesError("GitHub returned no commit data", 502, "github");
        }
        commit ??= data;
        files.push(...(data.files ?? []).map((file) => this.mapPullRequestFile(file)));

        const { hasNextPage, nextPage } = paginationFromLink(headers);
        if (!hasNextPage) break;
        if (nextPage === undefined || nextPage <= page || nextPage > MAX_COMMIT_FILE_PAGES) {
          filesComplete = null;
          break;
        }
        page = nextPage;
      }

      if (!commit) {
        throw new ForgesError("GitHub commit pagination produced no pages", 502, "github");
      }

      return {
        ...this.mapCommitSummary(commit),
        files,
        filesComplete: files.length < 3000 ? filesComplete : null,
      };
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async readCommitPatch(
    owner: string,
    repo: string,
    sha: string,
    options?: CommitPatchOptions,
  ): Promise<CommitPatch> {
    try {
      const files: CommitPatchFile[] = [];
      let resolvedSha: string | undefined;
      let filesComplete: boolean | null = true;
      let page = 1;

      while (page <= MAX_COMMIT_FILE_PAGES) {
        const commitRef = resolvedSha ?? sha;
        const encodedCommitRef =
          resolvedSha === undefined
            ? encodeRefPathSegment(commitRef)
            : encodePathSegment(commitRef);
        const route = `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/commits/${encodedCommitRef}`;
        const { data, headers } = await rawFetch<GitHubCommit>(this.client, route, {
          query: { page: String(page), per_page: "100" },
        });
        if (!data) throw new ForgesError("GitHub returned no commit data", 502, "github");
        if (resolvedSha !== undefined && data.sha !== resolvedSha) {
          throw new ForgesError(
            "GitHub changed commit identity during patch pagination",
            502,
            "github",
          );
        }
        resolvedSha ??= data.sha;
        files.push(
          ...(data.files ?? []).map(
            (file) =>
              ({
                path: file.filename,
                previousPath: file.previous_filename ?? null,
                status: normalizeChangedFileStatus(file.status),
                state: file.patch === undefined ? "unavailable" : "included",
                patch: file.patch ?? "",
              }) satisfies CommitPatchFile,
          ),
        );

        const { hasNextPage, nextPage } = paginationFromLink(headers);
        if (!hasNextPage) break;
        if (nextPage === undefined || nextPage <= page || nextPage > MAX_COMMIT_FILE_PAGES) {
          filesComplete = null;
          break;
        }
        page = nextPage;
      }

      if (resolvedSha === undefined) {
        throw new ForgesError("GitHub commit pagination produced no pages", 502, "github");
      }
      if ((options?.offset ?? 0) > 0 && sha !== resolvedSha) {
        throw new ForgesError(
          "Continue commit patches with the resolved SHA from the first page",
          409,
        );
      }
      return buildCommitPatch(
        resolvedSha,
        files,
        files.length < 3000 ? filesComplete : null,
        options,
      );
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  // --- Code search ---

  protected override async searchCode(
    searchQuery: string,
    options?: CodeSearchOptions,
  ): Promise<SearchPageResult<CodeSearchItem>> {
    try {
      const qualifiers: string[] = [];
      if (options?.owner !== undefined && options.repo !== undefined) {
        const owner = githubSearchQualifierSegment(options.owner);
        const repo = githubSearchQualifierSegment(options.repo);
        qualifiers.push(`repo:${owner}/${repo}`);
      } else if (options?.owner !== undefined) {
        qualifiers.push(`user:${githubSearchQualifierSegment(options.owner)}`);
      }

      const query: Record<string, string> = {
        q: qualifiers.length === 0 ? searchQuery : `${searchQuery} ${qualifiers.join(" ")}`,
      };
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);

      const { data, headers } = await rawFetch<GitHubCodeSearchResponse>(
        this.client,
        "/search/code",
        { query },
      );
      const rawItems = data?.items ?? [];
      const expectedOwner = options?.owner?.toLowerCase();
      const expectedRepository =
        options?.owner !== undefined && options.repo !== undefined
          ? `${options.owner}/${options.repo}`.toLowerCase()
          : undefined;
      const scopedItems = rawItems.filter((item) => {
        const repository = item.repository.full_name.toLowerCase();
        if (expectedRepository !== undefined) return repository === expectedRepository;
        if (expectedOwner !== undefined) return repository.startsWith(`${expectedOwner}/`);
        return true;
      });
      return {
        ...buildPageResult(scopedItems, headers, (raw) => ({
          repository: raw.repository.full_name,
          path: raw.path,
          url: raw.html_url,
        })),
        totalCount: data?.total_count,
        incomplete:
          (data?.incomplete_results ?? false) ||
          (data?.total_count ?? 0) > GITHUB_SEARCH_RESULT_LIMIT ||
          scopedItems.length !== rawItems.length,
      };
    } catch (error) {
      if (error instanceof FetchError && (error.status === 404 || error.status === 405)) {
        throw new ForgesError(
          "Code search is not supported by this GitHub-compatible host",
          501,
          "github",
          error,
        );
      }
      throw normalizeError(error, "github");
    }
  }

  protected override async getPullRequestReview(
    owner: string,
    repo: string,
    number: number,
    reviewId: string,
  ): Promise<PullRequestReview> {
    try {
      const raw = await this.client<GitHubPullRequestReview>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}/reviews/${encodePathSegment(reviewId)}`,
      );
      const review = this.mapPullRequestReview(raw);
      if (review === null) {
        throw new ForgesError(
          "This review state cannot be represented as a pull request review",
          501,
          "github",
        );
      }
      return review;
    } catch (error) {
      if (
        error instanceof FetchError &&
        error.status === 404 &&
        !(await this.isGitHubHost(owner, repo))
      ) {
        throw new ForgesError(
          "Pull request reviews are not supported by this GitHub-compatible host",
          501,
          "github",
          error,
        );
      }
      throw normalizeError(error, "github");
    }
  }

  protected override async listPullRequestReviews(
    owner: string,
    repo: string,
    number: number,
    options?: ListPullRequestReviewsOptions,
  ): Promise<PageResult<PullRequestReview>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);

      const { data, headers } = await rawFetch<GitHubPullRequestReview[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}/reviews`,
        { query },
      );
      const page = buildPageResult(data ?? [], headers, (raw) => this.mapPullRequestReview(raw));
      return { ...page, items: page.items.filter(isPullRequestReview) };
    } catch (error) {
      if (
        error instanceof FetchError &&
        error.status === 404 &&
        !(await this.isGitHubHost(owner, repo))
      ) {
        throw new ForgesError(
          "Pull request reviews are not supported by this GitHub-compatible host",
          501,
          "github",
          error,
        );
      }
      throw normalizeError(error, "github");
    }
  }

  // --- Releases ---

  private releasesRoute(owner: string, repo: string): string {
    return `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/releases`;
  }

  /** A 404 from a host without the releases API, GitBucket for one, is a 501, not a missing release. */
  private async releaseError(owner: string, repo: string, error: unknown): Promise<ForgesError> {
    if (
      error instanceof FetchError &&
      error.status === 404 &&
      !(await this.isGitHubHost(owner, repo))
    ) {
      return new ForgesError(
        "Releases are not supported by this GitHub-compatible host",
        501,
        "github",
        error,
      );
    }
    return normalizeError(error, "github");
  }

  protected override async listReleases(
    owner: string,
    repo: string,
    options?: ListReleasesOptions,
  ): Promise<PageResult<Release>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);

      const { data, headers } = await rawFetch<GitHubRelease[]>(
        this.client,
        this.releasesRoute(owner, repo),
        { query },
      );
      return buildPageResult(data ?? [], headers, (raw) => this.mapRelease(raw));
    } catch (error) {
      throw await this.releaseError(owner, repo, error);
    }
  }

  /** A draft has no tag in git yet, the tag route serves published releases only, and only a token sees drafts. */
  private async findDraftRelease(
    owner: string,
    repo: string,
    tag: string,
  ): Promise<GitHubRelease | null> {
    try {
      for (let page = 1; page <= MAX_DRAFT_RELEASE_PAGES; page += 1) {
        const { data, headers } = await rawFetch<GitHubRelease[]>(
          this.client,
          this.releasesRoute(owner, repo),
          { query: { page: String(page), per_page: "100" } },
        );
        const draft = (data ?? []).find((release) => release.draft && release.tag_name === tag);
        if (draft) return draft;
        if (!paginationFromLink(headers).hasNextPage) break;
      }
      return null;
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  private async readRelease(owner: string, repo: string, tag: string): Promise<GitHubRelease> {
    try {
      return await this.client<GitHubRelease>(
        `${this.releasesRoute(owner, repo)}/tags/${encodeRefPathSegment(tag)}`,
      );
    } catch (error) {
      const normalized = await this.releaseError(owner, repo, error);
      if (normalized.status !== 404 || !this.authenticated) throw normalized;
      const draft = await this.findDraftRelease(owner, repo, tag);
      if (draft) return draft;
      throw normalized;
    }
  }

  protected override async getRelease(owner: string, repo: string, tag: string): Promise<Release> {
    return this.mapRelease(await this.readRelease(owner, repo, tag));
  }

  protected override async createRelease(
    owner: string,
    repo: string,
    input: CreateReleaseInput,
  ): Promise<Release> {
    try {
      const data = await this.client<GitHubRelease>(this.releasesRoute(owner, repo), {
        method: "POST",
        body: {
          tag_name: input.tag,
          target_commitish: input.ref,
          name: input.name,
          body: input.body,
          draft: input.draft,
          prerelease: input.prerelease,
        },
      });
      return this.mapRelease(data);
    } catch (error) {
      throw await this.releaseError(owner, repo, error);
    }
  }

  /** The tag names the release, but GitHub edits by id, so the read comes first. */
  protected override async updateRelease(
    owner: string,
    repo: string,
    tag: string,
    input: UpdateReleaseInput,
  ): Promise<Release> {
    const release = await this.readRelease(owner, repo, tag);
    try {
      const data = await this.client<GitHubRelease>(
        `${this.releasesRoute(owner, repo)}/${encodePathSegment(release.id)}`,
        {
          method: "PATCH",
          body: {
            name: input.name,
            body: input.body,
            draft: input.draft,
            prerelease: input.prerelease,
          },
        },
      );
      return this.mapRelease(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  // --- Issues ---

  protected override async listIssues(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<Issue>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);
      if (options?.state) query.state = options.state;

      const { data, headers } = await rawFetch<GitHubIssue[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues`,
        { query },
      );

      const issuesOnly = (data ?? []).filter((issue) => issue.pull_request === undefined);
      return buildPageResult(issuesOnly, headers, (raw) => this.mapIssue(raw));
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async searchIssues(
    owner: string,
    repo: string,
    searchQuery: string,
    options?: ListOptions,
  ): Promise<SearchPageResult<Issue>> {
    try {
      const encodedOwner = encodePathSegment(owner);
      const encodedRepo = encodePathSegment(repo);
      const qualifiers = [`repo:${owner}/${repo}`, "is:issue"];
      if (options?.state && options.state !== "all") qualifiers.push(`is:${options.state}`);

      const query: Record<string, string> = {
        q: `${searchQuery} ${qualifiers.join(" ")}`,
      };
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);

      const { data, headers } = await rawFetch<GitHubIssueSearchResponse>(
        this.client,
        "/search/issues",
        { query },
      );
      const expectedRepositoryPath = `/repos/${encodedOwner}/${encodedRepo}`.toLowerCase();
      const rawIssues = data?.items ?? [];
      const scopedIssues = rawIssues.filter((issue) => {
        if (issue.pull_request !== undefined) return false;
        if (options?.state && options.state !== "all" && issue.state !== options.state)
          return false;
        if (!issue.repository_url) return false;
        try {
          return new URL(issue.repository_url).pathname
            .toLowerCase()
            .endsWith(expectedRepositoryPath);
        } catch {
          return false;
        }
      });

      return {
        ...buildPageResult(scopedIssues, headers, (raw) => this.mapIssue(raw)),
        incomplete: (data?.incomplete_results ?? false) || scopedIssues.length !== rawIssues.length,
      };
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async getIssue(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<Issue> {
    try {
      const data = await this.client<GitHubIssue>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues/${encodePathSegment(issueNumber)}`,
      );
      if (data.pull_request !== undefined) {
        throw new NotFoundError(`Issue not found: ${issueNumber}`, "github");
      }
      return this.mapIssue(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async createIssue(
    owner: string,
    repo: string,
    input: CreateIssueInput,
  ): Promise<Issue> {
    try {
      const data = await this.client<GitHubIssue>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues`,
        {
          method: "POST",
          body: {
            title: input.title,
            body: input.body,
            labels: input.labels,
            assignees: input.assignees,
          },
        },
      );
      return this.mapIssue(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  // --- Pull Requests ---

  protected override async listPullRequests(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<PullRequest>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);
      if (options?.state) query.state = options.state;

      const { data, headers } = await rawFetch<GitHubPullRequest[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls`,
        { query },
      );

      return buildPageResult(data ?? [], headers, (raw) => this.mapPullRequest(raw));
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async listPullRequestFiles(
    owner: string,
    repo: string,
    number: number,
    options?: ListPullRequestFilesOptions,
  ): Promise<PageResult<PullRequestFile>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);

      const { data, headers } = await rawFetch<GitHubPullRequestFile[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}/files`,
        { query },
      );
      return buildPageResult(data ?? [], headers, (raw) => this.mapPullRequestFile(raw));
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  /**
   * CLA bots and Jenkins report commit statuses, not check runs, and branch protection
   * can require one. Statuses go first: a handful of rows, and a required one is the
   * row nobody should have to find behind pages of check runs.
   */
  protected override async listPullRequestChecks(
    owner: string,
    repo: string,
    number: number,
    options?: ListPullRequestChecksOptions,
  ): Promise<PageResult<PullRequestCheck>> {
    try {
      const pullRequest = await this.getPullRequest(owner, repo, number);
      const perPage = options?.perPage ?? 30;
      const page = options?.page ?? 1;
      const skip = (page - 1) * perPage;
      const wanted = skip + perPage + 1;
      const revision = `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/commits/${encodePathSegment(pullRequest.headSha)}`;

      const statuses = await this.readRevisionRows<GitHubCombinedStatus, GitHubCommitStatus>(
        `${revision}/status`,
        (data) => data.statuses,
        wanted,
      );
      const runs = await this.readCheckRuns(
        owner,
        repo,
        `${revision}/check-runs`,
        Math.max(1, wanted - statuses.rows.length),
      );
      const checks = [
        ...statuses.rows.map((raw) => this.mapCommitStatus(raw)),
        ...runs.rows.map((raw) => this.mapPullRequestCheck(raw)),
      ];
      const items = checks.slice(skip, skip + perPage);
      const hasNextPage = checks.length > skip + perPage;
      return {
        items,
        totalCount: statuses.total + runs.total,
        hasNextPage,
        nextPage: hasNextPage ? page + 1 : undefined,
      };
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  /** A 404 from a host without check runs, GitBucket for one, leaves the commit statuses. */
  private async readCheckRuns(
    owner: string,
    repo: string,
    path: string,
    wanted: number,
  ): Promise<{ rows: GitHubCheckRun[]; total: number }> {
    try {
      return await this.readRevisionRows<GitHubCheckRunsResponse, GitHubCheckRun>(
        path,
        (data) => data.check_runs,
        wanted,
      );
    } catch (error) {
      if (
        error instanceof FetchError &&
        error.status === 404 &&
        !(await this.isGitHubHost(owner, repo))
      ) {
        return { rows: [], total: 0 };
      }
      throw error;
    }
  }

  /** Pages one revision listing until `wanted` rows are in hand, a page is empty or Link ends. */
  private async readRevisionRows<TResponse extends { total_count: number }, TRow>(
    path: string,
    rows: (data: TResponse) => TRow[],
    wanted: number,
  ): Promise<{ rows: TRow[]; total: number }> {
    const collected: TRow[] = [];
    const perPage = String(Math.min(100, wanted));
    let total = 0;
    let page = 1;
    while (collected.length < wanted) {
      const { data, headers } = await rawFetch<TResponse>(this.client, path, {
        query: { page: String(page), per_page: perPage },
      });
      if (data) total = data.total_count;
      const batch = data ? rows(data) : [];
      if (batch.length === 0) break;
      collected.push(...batch);
      const { hasNextPage, nextPage } = paginationFromLink(headers);
      if (!hasNextPage || nextPage === undefined || nextPage <= page) break;
      page = nextPage;
    }
    return { rows: collected, total };
  }

  protected override async searchPullRequestsGlobal(
    searchQuery: string,
    options?: GlobalPullRequestSearchOptions,
  ): Promise<GlobalPullRequestSearchResult> {
    try {
      const page = options?.page ?? 1;
      const perPage = options?.perPage ?? 30;
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        !Number.isSafeInteger(perPage) ||
        perPage < 1 ||
        perPage > 100
      ) {
        throw new ForgesError(
          "Pull-request search requires a positive page and perPage from 1 to 100",
          400,
        );
      }
      const offset = (page - 1) * perPage;
      if (offset >= GITHUB_SEARCH_RESULT_LIMIT) {
        throw new ForgesError(
          "GitHub pull-request search only exposes the first 1000 results",
          400,
        );
      }
      if (
        options?.sort !== undefined &&
        !["created", "updated", "comments"].includes(options.sort)
      ) {
        throw new ForgesError("Pull-request search sort must be created, updated or comments", 400);
      }
      if (options?.order !== undefined && !["asc", "desc"].includes(options.order)) {
        throw new ForgesError("Pull-request search order must be asc or desc", 400);
      }
      let query = `${searchQuery} is:pr`;
      if (options?.owner !== undefined) {
        const owner = githubSearchQualifierSegment(options.owner);
        query +=
          options.repo === undefined
            ? ` user:${owner}`
            : ` repo:${owner}/${githubSearchQualifierSegment(options.repo)}`;
      }
      const { data, headers } = await rawFetch<GitHubIssueSearchResponse>(
        this.client,
        "/search/issues",
        {
          query: {
            q: query,
            page: String(page),
            per_page: String(perPage),
            ...(options?.sort === undefined ? {} : { sort: options.sort }),
            ...(options?.order === undefined ? {} : { order: options.order }),
          },
        },
      );
      const rawItems = data?.items ?? [];
      const items: GlobalPullRequestSearchItem[] = [];
      for (const raw of rawItems.slice(0, GITHUB_SEARCH_RESULT_LIMIT - offset)) {
        if (raw.pull_request === undefined || !raw.repository_url) continue;
        let repository: string;
        try {
          const match = new URL(raw.repository_url).pathname.match(/\/repos\/([^/]+)\/([^/]+)$/u);
          if (!match) continue;
          repository = `${githubSearchQualifierSegment(decodeURIComponent(match[1]!))}/${githubSearchQualifierSegment(decodeURIComponent(match[2]!))}`;
        } catch {
          continue;
        }
        const normalized = repository.toLowerCase();
        if (
          options?.owner !== undefined &&
          !normalized.startsWith(`${options.owner.toLowerCase()}/`)
        )
          continue;
        if (
          options?.repo !== undefined &&
          normalized !== `${options.owner}/${options.repo}`.toLowerCase()
        )
          continue;
        items.push({ ...this.mapPullRequestSearchItem(raw), repository });
      }
      const result = buildPageResult(items, headers, (item) => item);
      if (page * perPage >= GITHUB_SEARCH_RESULT_LIMIT) {
        result.hasNextPage = false;
        delete result.nextPage;
      }
      return {
        ...result,
        totalCount: data?.total_count,
        incomplete:
          (data?.incomplete_results ?? false) ||
          (data?.total_count ?? 0) > GITHUB_SEARCH_RESULT_LIMIT ||
          items.length !== rawItems.length,
        resultLimit: GITHUB_SEARCH_RESULT_LIMIT,
      };
    } catch (error) {
      if (error instanceof FetchError && (error.status === 404 || error.status === 405)) {
        throw new ForgesError(
          "Global pull-request search is not supported by this GitHub-compatible host",
          501,
          "github",
          error,
        );
      }
      throw normalizeError(error, "github");
    }
  }

  protected override async searchPullRequests(
    owner: string,
    repo: string,
    searchQuery: string,
    options?: ListOptions,
  ): Promise<SearchPageResult<PullRequestSearchItem>> {
    try {
      const encodedOwner = encodePathSegment(owner);
      const encodedRepo = encodePathSegment(repo);
      const qualifiers = [`repo:${owner}/${repo}`, "is:pr"];
      if (options?.state && options.state !== "all") qualifiers.push(`is:${options.state}`);

      const query: Record<string, string> = {
        q: `${searchQuery} ${qualifiers.join(" ")}`,
      };
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);

      const { data, headers } = await rawFetch<GitHubIssueSearchResponse>(
        this.client,
        "/search/issues",
        { query },
      );
      const expectedRepositoryPath = `/repos/${encodedOwner}/${encodedRepo}`.toLowerCase();
      const rawPullRequests = data?.items ?? [];
      const scopedPullRequests = rawPullRequests.filter((pullRequest) => {
        if (pullRequest.pull_request === undefined) return false;
        if (options?.state && options.state !== "all" && pullRequest.state !== options.state)
          return false;
        if (!pullRequest.repository_url) return false;
        try {
          return new URL(pullRequest.repository_url).pathname
            .toLowerCase()
            .endsWith(expectedRepositoryPath);
        } catch {
          return false;
        }
      });

      return {
        ...buildPageResult(scopedPullRequests, headers, (raw) =>
          this.mapPullRequestSearchItem(raw),
        ),
        incomplete:
          (data?.incomplete_results ?? false) ||
          scopedPullRequests.length !== rawPullRequests.length,
      };
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async getPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PullRequest> {
    try {
      const data = await this.client<GitHubPullRequest>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(prNumber)}`,
      );
      return this.mapPullRequest(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  /**
   * Only GraphQL knows which issues a pull request closes. GitBucket serves no
   * GraphQL, so there the answer is unknown rather than an error.
   */
  protected override async listClosingIssues(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<ClosingIssue[] | null> {
    try {
      const issues: ClosingIssue[] = [];
      let cursor: string | null = null;
      for (;;) {
        const data: GitHubGraphQLClosingIssuesData = await this.graphql(CLOSING_ISSUES_QUERY, {
          owner,
          name: repo,
          number: prNumber,
          after: cursor,
        });
        const pullRequest = data.repository?.pullRequest;
        if (!pullRequest) {
          throw new NotFoundError(
            `Resource not found: pull request ${owner}/${repo}#${prNumber}`,
            "github",
          );
        }
        const connection = pullRequest.closingIssuesReferences;
        for (const node of presentGraphQLNodes(connection.nodes)) {
          issues.push({
            number: node.number,
            title: node.title,
            state: node.state === "CLOSED" ? "closed" : "open",
            url: node.url,
          });
        }
        const endCursor = connection.pageInfo.endCursor;
        if (!connection.pageInfo.hasNextPage || !endCursor || endCursor === cursor) break;
        cursor = endCursor;
      }
      return issues;
    } catch (error) {
      if (
        error instanceof ForgesError &&
        error.originalError instanceof FetchError &&
        (error.originalError.status === 404 || error.originalError.status === 405)
      ) {
        return null;
      }
      throw normalizeError(error, "github");
    }
  }

  protected override async createPullRequest(
    owner: string,
    repo: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequest> {
    try {
      const data = await this.client<GitHubPullRequest>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls`,
        {
          method: "POST",
          body: {
            title: input.title,
            body: input.body,
            head: input.sourceBranch,
            base: input.targetBranch,
            draft: input.draft,
          },
        },
      );
      if (!input.assignees?.length) {
        return this.mapPullRequest(data);
      }

      try {
        const assigned = await this.client<GitHubIssue>(
          `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues/${encodePathSegment(data.number)}/assignees`,
          { method: "POST", body: { assignees: input.assignees } },
        );
        return this.mapPullRequest({ ...data, assignees: assigned.assignees });
      } catch {
        return this.mapPullRequest(data);
      }
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  // --- Comments ---

  protected override async listIssueComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>> {
    try {
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);

      const { data, headers } = await rawFetch<GitHubComment[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues/${encodePathSegment(number)}/comments`,
        { query },
      );

      return buildPageResult(data ?? [], headers, (raw) => this.mapComment(raw));
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  /** GitHub serves pull-request discussion comments from the issues endpoint. */
  protected override async listPullRequestComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>> {
    return this.listIssueComments(owner, repo, number, options);
  }

  /**
   * GitHub keys discussion comments by id alone, so the endpoint cannot scope
   * the read. The returned issue_url is checked against the requested number
   * instead, so a comment from another issue answers 404 like it does on
   * GitLab. A payload without issue_url, which GitBucket may serve, skips the
   * check rather than failing reads that worked before.
   */
  protected override async getIssueComment(
    owner: string,
    repo: string,
    number: number,
    commentId: string,
  ): Promise<Comment> {
    try {
      const data = await this.client<GitHubComment>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues/comments/${encodePathSegment(commentId)}`,
      );
      if (data.issue_url && !data.issue_url.endsWith(`/issues/${number}`)) {
        throw new NotFoundError(`Comment not found: ${commentId}`, "github");
      }
      return this.mapComment(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  /** Pull-request discussion comments live on the issues endpoint too. */
  protected override async getPullRequestComment(
    owner: string,
    repo: string,
    number: number,
    commentId: string,
  ): Promise<Comment> {
    return this.getIssueComment(owner, repo, number, commentId);
  }

  // --- Users ---

  protected override async getUser(username: string): Promise<User> {
    try {
      const data = await this.client<GitHubUser>(`/users/${encodePathSegment(username)}`);
      return this.mapUser(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async getAuthenticatedUser(): Promise<User> {
    try {
      const data = await this.client<GitHubUser>("/user");
      return this.mapUser(data);
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  // --- Threads ---

  protected override async listThreads(
    owner: string,
    repo: string,
    number: number,
    options?: ListThreadOptions,
  ): Promise<PageResult<Thread>> {
    try {
      const perPage = options?.perPage ?? 30;
      const page = options?.page ?? 1;
      const skip = (page - 1) * perPage;
      const matched: Thread[] = [];
      let cursor: string | undefined;
      let hasMore = true;

      // Scan one match past the page: with a state filter, a full page says
      // nothing about whether any later thread still matches.
      while (hasMore && matched.length <= skip + perPage) {
        const data = await this.graphql<GitHubGraphQLThreadListData>(LIST_THREADS_QUERY, {
          owner,
          name: repo,
          number,
          first: 50,
          after: cursor ?? null,
          commentsAfter: null,
        });
        const pullRequest = data.repository?.pullRequest;
        if (!pullRequest) {
          throw new NotFoundError(
            `Resource not found: pull request ${owner}/${repo}#${number}`,
            "github",
          );
        }
        const connection = pullRequest.reviewThreads;
        for (const node of presentGraphQLNodes(connection.nodes)) {
          const thread = this.mapThread(await this.completeThreadComments(node));
          if (this.filterThreadsByState([thread], options?.state).length > 0) {
            matched.push(thread);
          }
        }
        const endCursor = connection.pageInfo.endCursor;
        hasMore =
          connection.pageInfo.hasNextPage &&
          endCursor !== null &&
          endCursor !== "" &&
          endCursor !== cursor;
        cursor = endCursor ?? undefined;
      }

      const items = matched.slice(skip, skip + perPage);
      const hasNextPage = matched.length > skip + perPage;
      return {
        items,
        hasNextPage,
        nextPage: hasNextPage ? page + 1 : undefined,
      };
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async getThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread> {
    try {
      const data = await this.graphql<GitHubGraphQLThreadNodeData>(GET_THREAD_QUERY, {
        id: threadId,
        commentsAfter: null,
      });
      if (!data.node || !threadMatchesPullRequest(data.node.pullRequest, owner, repo, number)) {
        throw new NotFoundError(
          `Resource not found: thread ${threadId} on ${owner}/${repo}#${number}`,
          "github",
        );
      }
      return this.mapThread(await this.completeThreadComments(data.node));
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async replyToThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
    input: ReplyThreadInput,
  ): Promise<ThreadComment> {
    try {
      // The reply target is always derived from the thread: a caller-supplied
      // comment id could point at another thread on the same pull request.
      const commentId = await this.rootCommentId(owner, repo, number, threadId);
      const data = await this.client<GitHubReviewComment>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}/comments/${encodePathSegment(commentId)}/replies`,
        {
          method: "POST",
          body: { body: input.body },
        },
      );
      return {
        id: String(data.id),
        body: data.body,
        author: { login: data.user?.login ?? "" },
        url: data.html_url,
        createdAt: data.created_at,
      };
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  protected override async resolveThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread> {
    return this.mutateThread(
      owner,
      repo,
      number,
      threadId,
      RESOLVE_THREAD_MUTATION,
      "resolveReviewThread",
    );
  }

  protected override async unresolveThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread> {
    return this.mutateThread(
      owner,
      repo,
      number,
      threadId,
      UNRESOLVE_THREAD_MUTATION,
      "unresolveReviewThread",
    );
  }

  private async mutateThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
    query: string,
    field: "resolveReviewThread" | "unresolveReviewThread",
  ): Promise<Thread> {
    try {
      await this.assertThreadScope(owner, repo, number, threadId);
      const data = await this.graphql<GitHubGraphQLThreadMutationData>(query, {
        id: threadId,
        commentsAfter: null,
      });
      const thread = data[field]?.thread;
      if (!thread) {
        throw new NotFoundError(
          `Resource not found: thread ${threadId} on ${owner}/${repo}#${number}`,
          "github",
        );
      }
      return this.mapThread(await this.completeThreadComments(thread));
    } catch (error) {
      throw normalizeError(error, "github");
    }
  }

  private async assertThreadScope(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<void> {
    const data = await this.graphql<GitHubGraphQLThreadScopeData>(THREAD_SCOPE_QUERY, {
      id: threadId,
    });
    if (!threadMatchesPullRequest(data.node?.pullRequest, owner, repo, number)) {
      throw new NotFoundError(
        `Resource not found: thread ${threadId} on ${owner}/${repo}#${number}`,
        "github",
      );
    }
  }

  private async rootCommentId(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<string> {
    const thread = await this.getThread(owner, repo, number, threadId);
    const commentId = thread.comments[0]?.id;
    if (!commentId) {
      throw new ForgesError(
        `Review thread ${threadId} has no comment id to reply to`,
        undefined,
        "github",
      );
    }
    return commentId;
  }

  private async completeThreadComments(
    thread: GitHubGraphQLReviewThread,
  ): Promise<GitHubGraphQLReviewThread> {
    const nodes = presentGraphQLNodes(thread.comments.nodes);
    let cursor = thread.comments.pageInfo.endCursor;
    let hasNextPage = thread.comments.pageInfo.hasNextPage;
    while (hasNextPage && cursor) {
      const data = await this.graphql<GitHubGraphQLThreadNodeData>(GET_THREAD_QUERY, {
        id: thread.id,
        commentsAfter: cursor,
      });
      const connection = data.node?.comments;
      if (!connection) {
        break;
      }
      nodes.push(...presentGraphQLNodes(connection.nodes));
      const nextCursor = connection.pageInfo.endCursor;
      if (!nextCursor || nextCursor === cursor) {
        break;
      }
      hasNextPage = connection.pageInfo.hasNextPage;
      cursor = nextCursor;
    }
    return {
      ...thread,
      comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
    };
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const url = githubGraphqlUrl(this.restBaseURL);
    let response: GitHubGraphQLResponse<T>;
    try {
      response = await this.client<GitHubGraphQLResponse<T>>(url, {
        method: "POST",
        body: { query, variables },
      });
    } catch (error) {
      // GitBucket serves GitHub REST v3 but no GraphQL, so the endpoint is absent.
      if (error instanceof FetchError && (error.status === 404 || error.status === 405)) {
        throw new ForgesError(
          `Review threads need the GitHub GraphQL API, which ${url} does not serve. REST-only hosts such as GitBucket cannot use thread operations.`,
          error.status,
          "github",
          error,
        );
      }
      throw error;
    }
    const firstError = response.errors?.[0];
    if (firstError) {
      if (firstError.type === "NOT_FOUND") {
        throw new NotFoundError(`Resource not found: ${firstError.message}`, "github");
      }
      throw new ForgesError(firstError.message, undefined, "github");
    }
    if (response.data === undefined || response.data === null) {
      throw new ForgesError("GitHub GraphQL returned no data", undefined, "github");
    }
    return response.data;
  }
}

/**
 * GitHub provider implementation
 * Also serves GitBucket (GitHub API v3 compatible) via custom baseURL
 */

import { Provider, type ProviderRawTypes } from "../provider.ts";
import type {
  ProviderConfig,
  Repository,
  CiRun,
  Issue,
  PullRequest,
  PullRequestCheck,
  PullRequestSearchItem,
  User,
  Owner,
  PageResult,
  SearchPageResult,
  ListOptions,
  ListCiRunsOptions,
  ListCommentOptions,
  ListPullRequestChecksOptions,
  ListThreadOptions,
  Comment,
  CreateIssueInput,
  CreatePullRequestInput,
  IssueState,
  ReplyThreadInput,
  Thread,
  ThreadComment,
} from "../types.ts";
import { FetchError } from "ofetch";
import { ForgesError, NotFoundError, normalizeError } from "../errors.ts";
import { createHttpClient, rawFetch, type HttpClient, type RawFetchResult } from "../http.ts";
import { parseLinkHeader } from "../pagination.ts";
import { encodePathSegment } from "./base-url.ts";
import { mapBooleanRepositoryPermission } from "../repository-access.ts";
import { normalizeCiRunState } from "../ci-run.ts";

// --- GitHub API response types (snake_case) ---

interface GitHubOwner {
  login: string;
  avatar_url: string;
}

interface GitHubRepositoryParent {
  full_name: string;
  html_url: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
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
  items: GitHubIssue[];
  incomplete_results: boolean;
}

interface GitHubPullRequest extends GitHubIssue {
  head: { ref: string; sha?: string | null };
  base: { ref: string };
  merged?: boolean;
  merged_at?: string | null;
  draft: boolean;
  merge_commit_sha?: string | null;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
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

function buildPageResult<TRaw, TMapped>(
  items: TRaw[],
  headers: Headers,
  mapper: (raw: TRaw) => TMapped,
): PageResult<TMapped> {
  const links = parseLinkHeader(headers.get("Link"));
  let nextPage: number | undefined;

  if (links.next) {
    const url = new URL(links.next);
    const page = url.searchParams.get("page");
    if (page) {
      nextPage = parseInt(page, 10);
    }
  }

  return {
    items: items.map(mapper),
    hasNextPage: !!links.next,
    nextPage,
  };
}

// --- Provider ---

export class GitHubProvider extends Provider<GitHubRawTypes> {
  private client: HttpClient;
  private readonly restBaseURL: string;

  constructor(config: ProviderConfig) {
    super();
    this.restBaseURL = config.baseURL || "https://api.github.com";
    this.client = createHttpClient({
      baseURL: this.restBaseURL,
      token: config.token ?? "",
      tokenHeader: "Authorization",
      tokenPrefix: "token ",
    });
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

  private mapPullRequestCheck(raw: GitHubCheckRun): PullRequestCheck {
    return {
      id: String(raw.id),
      name: raw.name,
      ...normalizeCiRunState(raw.status, raw.conclusion),
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
   * returns 404 for regular users, which selects the user route.
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

        response = await rawFetch<GitHubRepo[]>(
          this.client,
          `/users/${encodePathSegment(owner)}/repos`,
          { query },
        );
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

  protected override async listPullRequestChecks(
    owner: string,
    repo: string,
    number: number,
    options?: ListPullRequestChecksOptions,
  ): Promise<PageResult<PullRequestCheck>> {
    try {
      const pullRequest = await this.getPullRequest(owner, repo, number);
      const query: Record<string, string> = {};
      if (options?.page) query.page = String(options.page);
      if (options?.perPage) query.per_page = String(options.perPage);

      const { data, headers } = await rawFetch<GitHubCheckRunsResponse>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/commits/${encodePathSegment(pullRequest.headSha)}/check-runs`,
        { query },
      );
      return {
        ...buildPageResult(data?.check_runs ?? [], headers, (raw) => this.mapPullRequestCheck(raw)),
        totalCount: data?.total_count,
      };
    } catch (error) {
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

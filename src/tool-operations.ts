import { createProvider, resolveToken } from "./index.ts";
import type {
  InspectLocalOptions,
  LocalInspection,
  LocalMergeVerification,
  VerifyLocalMergeOptions,
} from "./local.ts";
import { assertAssignees } from "./assignees.ts";
import { AuthenticationError } from "./errors.ts";
import type { ForgesPlatform } from "../packages/shared/forges-tool-schemas.ts";
import type { Provider } from "./provider.ts";
import type {
  CiRun,
  CodeSearchItem,
  CodeSearchOptions,
  Comment,
  Commit,
  ContributionTemplate,
  ContributionTemplateKind,
  ContributionTemplateSummary,
  CommitSummary,
  CreateIssueInput,
  CreatePullRequestInput,
  CreateReleaseInput,
  Issue,
  IssueState,
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
  PageResult,
  PullRequest,
  PullRequestCheck,
  PullRequestFile,
  PullRequestReview,
  PullRequestSearchItem,
  Release,
  ReplyThreadInput,
  Repository,
  SearchPageResult,
  Thread,
  ThreadComment,
  ThreadState,
  UpdateReleaseInput,
  User,
} from "./types.ts";

export type { ForgesPlatform };

const baseUrlEnvByPlatform: Record<ForgesPlatform, string> = {
  github: "FORGES_GITHUB_BASE_URL",
  gitlab: "FORGES_GITLAB_BASE_URL",
  gitea: "FORGES_GITEA_BASE_URL",
};

/**
 * Authenticated providers stay pinned so a confirmed account cannot drift before a write.
 *
 * The maps hold the creation promise rather than the instance: provider modules
 * load on demand, and two calls racing on a cold platform must share one
 * credential resolution instead of pinning whichever finished last.
 */
const pinnedProviders = new Map<string, Promise<Provider>>();
/** Anonymous providers are isolated because no write may reuse one. */
const anonymousReadProviders = new Map<string, Promise<Provider>>();
const credentialOperationTails = new Map<ForgesPlatform, Promise<void>>();

/** Keep reloads and hosted writes ordered around one platform's pinned identity. */
async function withCredentialOperation<T>(
  platform: ForgesPlatform,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = credentialOperationTails.get(platform) ?? Promise.resolve();
  const next = Promise.withResolvers<void>();
  const tail = previous.then(() => next.promise);
  credentialOperationTails.set(platform, tail);
  await previous;

  try {
    return await operation();
  } finally {
    next.resolve();
    if (credentialOperationTails.get(platform) === tail) credentialOperationTails.delete(platform);
  }
}

function providerKey(platform: ForgesPlatform): string {
  const baseURL = process.env[baseUrlEnvByPlatform[platform]];
  return baseURL === undefined ? platform : `${platform} ${baseURL}`;
}

function configuredToken(platform: ForgesPlatform): string {
  const baseURL = process.env[baseUrlEnvByPlatform[platform]];
  return resolveToken(platform, { baseURL })?.token ?? "";
}

async function createConfiguredProvider(
  platform: ForgesPlatform,
  token: string,
): Promise<Provider> {
  const baseURL = process.env[baseUrlEnvByPlatform[platform]];
  return createProvider(platform, baseURL === undefined ? { token } : { baseURL, token });
}

/** Start one provider load under a key and forget it again if the load fails. */
function trackProvider(
  providers: Map<string, Promise<Provider>>,
  key: string,
  platform: ForgesPlatform,
  token: string,
): Promise<Provider> {
  const provider = createConfiguredProvider(platform, token);
  providers.set(key, provider);
  provider.catch(() => {
    if (providers.get(key) === provider) providers.delete(key);
  });
  return provider;
}

function credentialSetupHint(platform: ForgesPlatform): string {
  switch (platform) {
    case "github":
      return "Set GITHUB_TOKEN or log in with `gh auth login`.";
    case "gitlab":
      return "Set GITLAB_TOKEN or log in with `glab auth login`.";
    case "gitea":
      return "Set GITEA_TOKEN or log in with `tea login add`.";
  }
}

async function authenticatedProvider(platform: ForgesPlatform): Promise<Provider> {
  const key = providerKey(platform);
  const pinned = pinnedProviders.get(key);
  if (pinned) return pinned;

  const token = configuredToken(platform);
  if (token === "") {
    throw new AuthenticationError(
      `No auth token found for ${platform}. ${credentialSetupHint(platform)}`,
      platform,
    );
  }

  return trackProvider(pinnedProviders, key, platform, token);
}

function readProvider(platform: ForgesPlatform): Promise<Provider> {
  const key = providerKey(platform);
  const authenticated = pinnedProviders.get(key);
  if (authenticated) return authenticated;

  const token = configuredToken(platform);
  if (token !== "") {
    anonymousReadProviders.delete(key);
    return trackProvider(pinnedProviders, key, platform, token);
  }

  return (
    anonymousReadProviders.get(key) ?? trackProvider(anonymousReadProviders, key, platform, token)
  );
}

/** Drop pinned providers so the next matching call resolves its local credential again. */
export function resetPinnedProviders(platform?: ForgesPlatform): void {
  if (platform === undefined) {
    pinnedProviders.clear();
    anonymousReadProviders.clear();
    return;
  }

  for (const providers of [pinnedProviders, anonymousReadProviders]) {
    for (const key of providers.keys()) {
      if (key === platform || key.startsWith(`${platform} `)) providers.delete(key);
    }
  }
}

export interface PlatformParams {
  platform: ForgesPlatform;
}

export interface OwnerParams extends PlatformParams {
  owner: string;
}

export interface RepositoryParams extends OwnerParams {
  repo: string;
}

export interface ListRepositoriesParams extends OwnerParams {
  page?: number;
  perPage?: number;
}

export type GetRepositoryParams = RepositoryParams;

export interface ListContributionTemplatesParams extends RepositoryParams {
  readonly kind: ContributionTemplateKind;
  readonly page?: number;
  readonly perPage?: number;
}

export interface GetContributionTemplateParams extends RepositoryParams {
  readonly kind: ContributionTemplateKind;
  readonly key: string;
}

export interface SearchCodeParams extends PlatformParams, CodeSearchOptions {
  query: string;
}

export interface GetCommitParams extends RepositoryParams {
  sha: string;
}

export type ListCommitsParams = RepositoryParams & ListCommitOptions;

export interface ListCiRunsParams extends RepositoryParams {
  branch?: string;
  page?: number;
  perPage?: number;
}

export interface ListReleasesParams extends RepositoryParams {
  page?: number;
  perPage?: number;
}

export interface GetReleaseParams extends RepositoryParams {
  tag: string;
}

export type CreateReleaseParams = RepositoryParams & CreateReleaseInput;

export type UpdateReleaseParams = GetReleaseParams & UpdateReleaseInput;

export interface ListRepositoryItemsParams extends RepositoryParams {
  page?: number;
  perPage?: number;
  state?: IssueState | "all";
}

export interface SearchRepositoryItemsParams extends ListRepositoryItemsParams {
  query: string;
}

export type SearchRepositoryIssuesParams = SearchRepositoryItemsParams;
export type SearchRepositoryPullRequestsParams = SearchRepositoryItemsParams;

export interface GetRepositoryItemParams extends RepositoryParams {
  number: number;
}

export type CreateIssueParams = RepositoryParams & CreateIssueInput;

export type CreatePullRequestParams = RepositoryParams & CreatePullRequestInput;

export interface ListCommentsParams extends RepositoryParams {
  number: number;
  page?: number;
  perPage?: number;
}

export type ListPullRequestFilesParams = ListCommentsParams;
export type ListPullRequestChecksParams = ListCommentsParams;
export type ListPullRequestReviewsParams = ListCommentsParams;

export interface GetPullRequestReviewParams extends GetRepositoryItemParams {
  reviewId: string;
}

export interface GetCommentParams extends RepositoryParams {
  number: number;
  commentId: string;
}

export interface GetUserParams extends PlatformParams {
  username: string;
}

export interface ForgesToolDetails<T> {
  platform: ForgesPlatform | "local";
  result: T;
}

export interface ForgesToolResult<T> {
  content: [{ type: "text"; text: string }];
  details: ForgesToolDetails<T>;
}

function result<T>(
  platform: ForgesPlatform | "local",
  value: T,
  note?: string,
): ForgesToolResult<T> {
  const details = { platform, result: value };
  const modelDetails = note ? { ...details, note } : details;
  return {
    content: [{ type: "text", text: JSON.stringify(modelDetails, null, 2) }],
    details,
  };
}

function assignmentNote(
  requested: string[] | undefined,
  actual: Array<{ login: string }>,
): string | undefined {
  if (!requested?.length) return undefined;
  const assigned = new Set(actual.map(({ login }) => login.toLowerCase()));
  const missing = requested.filter((login) => !assigned.has(login.toLowerCase()));
  if (missing.length === 0) return undefined;
  return `Creation succeeded, but requested assignees are missing: ${missing.join(", ")}. Do not retry the create call; the result is the created object.`;
}

function summarizeIssuePage<T extends Issue>(
  page: SearchPageResult<T>,
): SearchPageResult<Omit<T, "body">>;
function summarizeIssuePage<T extends Issue>(page: PageResult<T>): PageResult<Omit<T, "body">>;
function summarizeIssuePage<T extends Issue>(page: PageResult<T>): PageResult<Omit<T, "body">> {
  return {
    ...page,
    items: page.items.map(({ body: _body, ...summary }) => summary),
  };
}

/** A minified or generated comment can be one very long line, so cap both axes. */
const COMMENT_SUMMARY_MAX_LINES = 12;
const COMMENT_SUMMARY_MAX_CHARS = 4000;

function summarizeCommentBody(body: string): string {
  return body
    .split("\n")
    .slice(0, COMMENT_SUMMARY_MAX_LINES)
    .join("\n")
    .slice(0, COMMENT_SUMMARY_MAX_CHARS);
}

function summarizeCommentPage(page: PageResult<Comment>): PageResult<Comment> {
  return {
    ...page,
    items: page.items.map((comment) => ({
      ...comment,
      body: summarizeCommentBody(comment.body),
    })),
  };
}

function summarizeReviewPage(page: PageResult<PullRequestReview>): PageResult<PullRequestReview> {
  return {
    ...page,
    items: page.items.map((review) => ({
      ...review,
      body: summarizeCommentBody(review.body),
    })),
  };
}

function listOptions(params: {
  page?: number;
  perPage?: number;
  state?: IssueState | "all";
}): ListOptions {
  return {
    page: params.page,
    perPage: params.perPage,
    state: params.state,
  };
}

export async function listRepositories(
  params: ListRepositoriesParams,
): Promise<ForgesToolResult<PageResult<Repository>>> {
  const provider = await readProvider(params.platform);
  const repositories = await provider.repos.list(params.owner, listOptions(params));
  return result(params.platform, repositories);
}

export async function getRepository(
  params: GetRepositoryParams,
): Promise<ForgesToolResult<Repository>> {
  const provider = await readProvider(params.platform);
  const repository = await provider.repos.get(params.owner, params.repo);
  return result(params.platform, repository);
}

export async function listContributionTemplates(
  params: ListContributionTemplatesParams,
): Promise<ForgesToolResult<PageResult<ContributionTemplateSummary>>> {
  const options: ListContributionTemplatesOptions = {
    page: params.page,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const templates = await provider.contributionTemplates.list(
    params.owner,
    params.repo,
    params.kind,
    options,
  );
  return result(
    params.platform,
    templates,
    "Template bodies are omitted from list output; use forges_contribution_templates_get with the returned kind and key.",
  );
}

export async function getContributionTemplate(
  params: GetContributionTemplateParams,
): Promise<ForgesToolResult<ContributionTemplate>> {
  const provider = await readProvider(params.platform);
  const template = await provider.contributionTemplates.get(
    params.owner,
    params.repo,
    params.kind,
    params.key,
  );
  return result(params.platform, template);
}

export async function searchCode(
  params: SearchCodeParams,
): Promise<ForgesToolResult<SearchPageResult<CodeSearchItem>>> {
  const provider = await readProvider(params.platform);
  const search = await provider.code.search(params.query, {
    owner: params.owner,
    repo: params.repo,
    page: params.page,
    perPage: params.perPage,
  });
  return result(params.platform, search);
}

export async function listCiRuns(
  params: ListCiRunsParams,
): Promise<ForgesToolResult<PageResult<CiRun>>> {
  const options: ListCiRunsOptions = {
    branch: params.branch,
    page: params.page,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const runs = await provider.ciRuns.list(params.owner, params.repo, options);
  return result(params.platform, runs);
}

export async function listCommits(
  params: ListCommitsParams,
): Promise<ForgesToolResult<PageResult<CommitSummary>>> {
  const provider = await readProvider(params.platform);
  const commits = await provider.commits.list(params.owner, params.repo, {
    ref: params.ref,
    path: params.path,
    since: params.since,
    until: params.until,
    page: params.page,
    perPage: params.perPage,
  });
  return result(params.platform, commits);
}

export async function getCommit(params: GetCommitParams): Promise<ForgesToolResult<Commit>> {
  const provider = await readProvider(params.platform);
  const commit = await provider.commits.get(params.owner, params.repo, params.sha);
  return result(params.platform, commit);
}

function summarizeReleasePage(page: PageResult<Release>): PageResult<Omit<Release, "body">> {
  return {
    ...page,
    items: page.items.map(({ body: _body, ...summary }) => summary),
  };
}

export async function listReleases(
  params: ListReleasesParams,
): Promise<ForgesToolResult<PageResult<Omit<Release, "body">>>> {
  const options: ListReleasesOptions = {
    page: params.page,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const releases = await provider.releases.list(params.owner, params.repo, options);
  return result(
    params.platform,
    summarizeReleasePage(releases),
    "Release notes are omitted from list output; use forges_releases_get with the tag to read one in full.",
  );
}

export async function getRelease(params: GetReleaseParams): Promise<ForgesToolResult<Release>> {
  const provider = await readProvider(params.platform);
  const release = await provider.releases.get(params.owner, params.repo, params.tag);
  return result(params.platform, release);
}

export function createRelease(params: CreateReleaseParams): Promise<ForgesToolResult<Release>> {
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform);
    const release = await provider.releases.create(params.owner, params.repo, {
      tag: params.tag,
      name: params.name,
      body: params.body,
      ref: params.ref,
      draft: params.draft,
      prerelease: params.prerelease,
    });
    return result(params.platform, release);
  });
}

export function updateRelease(params: UpdateReleaseParams): Promise<ForgesToolResult<Release>> {
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform);
    const release = await provider.releases.update(params.owner, params.repo, params.tag, {
      name: params.name,
      body: params.body,
      draft: params.draft,
      prerelease: params.prerelease,
    });
    return result(params.platform, release);
  });
}

export async function listIssues(
  params: ListRepositoryItemsParams,
): Promise<ForgesToolResult<PageResult<Omit<Issue, "body">>>> {
  const provider = await readProvider(params.platform);
  const issues = await provider.issues.list(params.owner, params.repo, listOptions(params));
  return result(
    params.platform,
    summarizeIssuePage(issues),
    "Issue bodies are omitted from list output; use forges_issues_get to read one body.",
  );
}

export async function searchIssues(
  params: SearchRepositoryIssuesParams,
): Promise<ForgesToolResult<SearchPageResult<Omit<Issue, "body">>>> {
  const provider = await readProvider(params.platform);
  const issues = await provider.issues.search(
    params.owner,
    params.repo,
    params.query,
    listOptions(params),
  );
  return result(
    params.platform,
    summarizeIssuePage(issues),
    "Issue bodies are omitted from search output; use forges_issues_get to read one body.",
  );
}

export async function getIssue(params: GetRepositoryItemParams): Promise<ForgesToolResult<Issue>> {
  const provider = await readProvider(params.platform);
  const issue = await provider.issues.get(params.owner, params.repo, params.number);
  return result(params.platform, issue);
}

function commentListOptions(params: ListCommentsParams): ListCommentOptions {
  return {
    page: params.page,
    perPage: params.perPage,
  };
}

export async function listIssueComments(
  params: ListCommentsParams,
): Promise<ForgesToolResult<PageResult<Comment>>> {
  const provider = await readProvider(params.platform);
  const comments = await provider.issues.listComments(
    params.owner,
    params.repo,
    params.number,
    commentListOptions(params),
  );
  return result(
    params.platform,
    summarizeCommentPage(comments),
    "Comment bodies are truncated in list output; use forges_issues_comments_get to read one in full.",
  );
}

export async function getIssueComment(
  params: GetCommentParams,
): Promise<ForgesToolResult<Comment>> {
  const provider = await readProvider(params.platform);
  const comment = await provider.issues.getComment(
    params.owner,
    params.repo,
    params.number,
    params.commentId,
  );
  return result(params.platform, comment);
}

export async function createIssue(params: CreateIssueParams): Promise<ForgesToolResult<Issue>> {
  assertAssignees(params.assignees, params.platform);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform);
    const issue = await provider.issues.create(params.owner, params.repo, {
      title: params.title,
      body: params.body,
      labels: params.labels,
      assignees: params.assignees,
    });
    return result(params.platform, issue, assignmentNote(params.assignees, issue.assignees));
  });
}

export async function listPullRequests(
  params: ListRepositoryItemsParams,
): Promise<ForgesToolResult<PageResult<Omit<PullRequest, "body">>>> {
  const provider = await readProvider(params.platform);
  const pullRequests = await provider.pullRequests.list(
    params.owner,
    params.repo,
    listOptions(params),
  );
  return result(
    params.platform,
    summarizeIssuePage(pullRequests),
    "Pull-request bodies are omitted from list output; use forges_pull_requests_get to read one body.",
  );
}

export async function listPullRequestFiles(
  params: ListPullRequestFilesParams,
): Promise<ForgesToolResult<PageResult<PullRequestFile>>> {
  const options: ListPullRequestFilesOptions = {
    page: params.page,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const files = await provider.pullRequests.listFiles(
    params.owner,
    params.repo,
    params.number,
    options,
  );
  return result(params.platform, files);
}

export async function listPullRequestChecks(
  params: ListPullRequestChecksParams,
): Promise<ForgesToolResult<PageResult<PullRequestCheck>>> {
  const options: ListPullRequestChecksOptions = {
    page: params.page,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const checks = await provider.pullRequests.listChecks(
    params.owner,
    params.repo,
    params.number,
    options,
  );
  return result(params.platform, checks);
}

export async function listPullRequestReviews(
  params: ListPullRequestReviewsParams,
): Promise<ForgesToolResult<PageResult<PullRequestReview>>> {
  const options: ListPullRequestReviewsOptions = {
    page: params.page,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const reviews = await provider.pullRequests.listReviews(
    params.owner,
    params.repo,
    params.number,
    options,
  );
  return result(
    params.platform,
    summarizeReviewPage(reviews),
    "Review bodies are truncated in list output; use forges_pull_requests_reviews_get to read one in full on GitHub or Gitea. GitLab entries are reviewer stances, not review bodies.",
  );
}

export async function getPullRequestReview(
  params: GetPullRequestReviewParams,
): Promise<ForgesToolResult<PullRequestReview>> {
  const provider = await readProvider(params.platform);
  const review = await provider.pullRequests.getReview(
    params.owner,
    params.repo,
    params.number,
    params.reviewId,
  );
  return result(params.platform, review);
}

export async function searchPullRequests(
  params: SearchRepositoryPullRequestsParams,
): Promise<ForgesToolResult<SearchPageResult<Omit<PullRequestSearchItem, "body">>>> {
  const provider = await readProvider(params.platform);
  const pullRequests = await provider.pullRequests.search(
    params.owner,
    params.repo,
    params.query,
    listOptions(params),
  );
  return result(
    params.platform,
    summarizeIssuePage(pullRequests),
    "Pull-request bodies and revision details are omitted from search output; use forges_pull_requests_get to read one in full.",
  );
}

export async function getPullRequest(
  params: GetRepositoryItemParams,
): Promise<ForgesToolResult<PullRequest>> {
  const provider = await readProvider(params.platform);
  const pullRequest = await provider.pullRequests.get(params.owner, params.repo, params.number);
  return result(params.platform, pullRequest);
}

export async function listPullRequestComments(
  params: ListCommentsParams,
): Promise<ForgesToolResult<PageResult<Comment>>> {
  const provider = await readProvider(params.platform);
  const comments = await provider.pullRequests.listComments(
    params.owner,
    params.repo,
    params.number,
    commentListOptions(params),
  );
  return result(
    params.platform,
    summarizeCommentPage(comments),
    "Comment bodies are truncated in list output; use forges_pull_requests_comments_get to read one in full.",
  );
}

export async function getPullRequestComment(
  params: GetCommentParams,
): Promise<ForgesToolResult<Comment>> {
  const provider = await readProvider(params.platform);
  const comment = await provider.pullRequests.getComment(
    params.owner,
    params.repo,
    params.number,
    params.commentId,
  );
  return result(params.platform, comment);
}

export async function createPullRequest(
  params: CreatePullRequestParams,
): Promise<ForgesToolResult<PullRequest>> {
  assertAssignees(params.assignees, params.platform);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform);
    const pullRequest = await provider.pullRequests.create(params.owner, params.repo, {
      title: params.title,
      body: params.body,
      sourceBranch: params.sourceBranch,
      targetBranch: params.targetBranch,
      draft: params.draft,
      assignees: params.assignees,
    });
    return result(
      params.platform,
      pullRequest,
      assignmentNote(params.assignees, pullRequest.assignees),
    );
  });
}

export async function getUser(params: GetUserParams): Promise<ForgesToolResult<User>> {
  const provider = await readProvider(params.platform);
  const user = await provider.users.get(params.username);
  return result(params.platform, user);
}

async function authenticatedUserResult(platform: ForgesPlatform): Promise<ForgesToolResult<User>> {
  const provider = await authenticatedProvider(platform);
  return result(platform, await provider.users.authenticated());
}

export function getAuthenticatedUser(params: PlatformParams): Promise<ForgesToolResult<User>> {
  return withCredentialOperation(params.platform, () => authenticatedUserResult(params.platform));
}

/** Replace one platform's pinned credential and return the newly authenticated account. */
export function reloadAuthentication(params: PlatformParams): Promise<ForgesToolResult<User>> {
  return withCredentialOperation(params.platform, () => {
    resetPinnedProviders(params.platform);
    return authenticatedUserResult(params.platform);
  });
}

export interface ListThreadsParams extends RepositoryParams {
  number: number;
  page?: number;
  perPage?: number;
  state?: ThreadState;
}

export interface GetThreadParams extends RepositoryParams {
  number: number;
  threadId: string;
}

export type ReplyThreadParams = GetThreadParams & ReplyThreadInput;

function summarizeThreadPage(page: PageResult<Thread>): PageResult<Thread> {
  return {
    ...page,
    items: page.items.map((thread) => ({
      ...thread,
      comments: thread.comments.map((comment) => ({
        ...comment,
        body: summarizeCommentBody(comment.body),
      })),
    })),
  };
}

function threadListOptions(params: ListThreadsParams): ListThreadOptions {
  return {
    page: params.page,
    perPage: params.perPage,
    state: params.state,
  };
}

export async function listThreads(
  params: ListThreadsParams,
): Promise<ForgesToolResult<PageResult<Thread>>> {
  const provider = await readProvider(params.platform);
  const threads = await provider.threads.list(
    params.owner,
    params.repo,
    params.number,
    threadListOptions(params),
  );
  return result(
    params.platform,
    summarizeThreadPage(threads),
    "Comment bodies are truncated in list output; use forges_threads_get to read one full thread.",
  );
}

export async function getThread(params: GetThreadParams): Promise<ForgesToolResult<Thread>> {
  const provider = await readProvider(params.platform);
  const thread = await provider.threads.get(
    params.owner,
    params.repo,
    params.number,
    params.threadId,
  );
  return result(params.platform, thread);
}

export function replyToThread(params: ReplyThreadParams): Promise<ForgesToolResult<ThreadComment>> {
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform);
    const comment = await provider.threads.reply(
      params.owner,
      params.repo,
      params.number,
      params.threadId,
      { body: params.body },
    );
    return result(params.platform, comment);
  });
}

export function resolveThread(params: GetThreadParams): Promise<ForgesToolResult<Thread>> {
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform);
    const thread = await provider.threads.resolve(
      params.owner,
      params.repo,
      params.number,
      params.threadId,
    );
    return result(params.platform, thread);
  });
}

export function unresolveThread(params: GetThreadParams): Promise<ForgesToolResult<Thread>> {
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform);
    const thread = await provider.threads.unresolve(
      params.owner,
      params.repo,
      params.number,
      params.threadId,
    );
    return result(params.platform, thread);
  });
}

export async function verifyLocalMerge(
  params: VerifyLocalMergeOptions,
): Promise<ForgesToolResult<LocalMergeVerification>> {
  const local = await import("./local.ts");
  return result("local", await local.verifyLocalMerge(params));
}

export async function inspectLocal(
  params: InspectLocalOptions,
): Promise<ForgesToolResult<LocalInspection>> {
  const local = await import("./local.ts");
  return result("local", await local.inspectLocal(params));
}

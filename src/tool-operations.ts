import { createProvider, resolveToken } from "./index.ts";
import { assertAssignees } from "./assignees.ts";
import { AuthenticationError } from "./errors.ts";
import type { ForgesPlatform } from "../packages/shared/forges-tool-schemas.ts";
import type { Provider } from "./provider.ts";
import type {
  CiRun,
  Comment,
  CreateIssueInput,
  CreatePullRequestInput,
  Issue,
  IssueState,
  ListCiRunsOptions,
  ListCommentOptions,
  ListOptions,
  ListPullRequestChecksOptions,
  ListPullRequestFilesOptions,
  ListThreadOptions,
  PageResult,
  PullRequest,
  PullRequestCheck,
  PullRequestFile,
  PullRequestSearchItem,
  ReplyThreadInput,
  Repository,
  SearchPageResult,
  Thread,
  ThreadComment,
  ThreadState,
  User,
} from "./types.ts";

export type { ForgesPlatform };

const baseUrlEnvByPlatform: Record<ForgesPlatform, string> = {
  github: "FORGES_GITHUB_BASE_URL",
  gitlab: "FORGES_GITLAB_BASE_URL",
  gitea: "FORGES_GITEA_BASE_URL",
};

/** Authenticated providers stay pinned so a confirmed account cannot drift before a write. */
const pinnedProviders = new Map<string, Provider>();
/** Anonymous providers are isolated because no write may reuse one. */
const anonymousReadProviders = new Map<string, Provider>();
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

function createConfiguredProvider(platform: ForgesPlatform, token: string): Provider {
  const baseURL = process.env[baseUrlEnvByPlatform[platform]];
  return createProvider(platform, baseURL === undefined ? { token } : { baseURL, token });
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

function authenticatedProvider(platform: ForgesPlatform): Provider {
  const key = providerKey(platform);
  let provider = pinnedProviders.get(key);
  if (provider) return provider;

  const token = configuredToken(platform);
  if (token === "") {
    throw new AuthenticationError(
      `No auth token found for ${platform}. ${credentialSetupHint(platform)}`,
      platform,
    );
  }

  provider = createConfiguredProvider(platform, token);
  pinnedProviders.set(key, provider);
  return provider;
}

function readProvider(platform: ForgesPlatform): Provider {
  const key = providerKey(platform);
  const authenticated = pinnedProviders.get(key);
  if (authenticated) return authenticated;

  const token = configuredToken(platform);
  if (token !== "") {
    const provider = createConfiguredProvider(platform, token);
    anonymousReadProviders.delete(key);
    pinnedProviders.set(key, provider);
    return provider;
  }

  let provider = anonymousReadProviders.get(key);
  if (!provider) {
    provider = createConfiguredProvider(platform, token);
    anonymousReadProviders.set(key, provider);
  }
  return provider;
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

export interface ListCiRunsParams extends RepositoryParams {
  branch?: string;
  page?: number;
  perPage?: number;
}

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

export interface GetCommentParams extends RepositoryParams {
  number: number;
  commentId: string;
}

export interface GetUserParams extends PlatformParams {
  username: string;
}

export interface ForgesToolDetails<T> {
  platform: ForgesPlatform;
  result: T;
}

export interface ForgesToolResult<T> {
  content: [{ type: "text"; text: string }];
  details: ForgesToolDetails<T>;
}

function result<T>(platform: ForgesPlatform, value: T, note?: string): ForgesToolResult<T> {
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
  const repositories = await readProvider(params.platform).repos.list(
    params.owner,
    listOptions(params),
  );
  return result(params.platform, repositories);
}

export async function getRepository(
  params: GetRepositoryParams,
): Promise<ForgesToolResult<Repository>> {
  const repository = await readProvider(params.platform).repos.get(params.owner, params.repo);
  return result(params.platform, repository);
}

export async function listCiRuns(
  params: ListCiRunsParams,
): Promise<ForgesToolResult<PageResult<CiRun>>> {
  const options: ListCiRunsOptions = {
    branch: params.branch,
    page: params.page,
    perPage: params.perPage,
  };
  const runs = await readProvider(params.platform).ciRuns.list(params.owner, params.repo, options);
  return result(params.platform, runs);
}

export async function listIssues(
  params: ListRepositoryItemsParams,
): Promise<ForgesToolResult<PageResult<Omit<Issue, "body">>>> {
  const issues = await readProvider(params.platform).issues.list(
    params.owner,
    params.repo,
    listOptions(params),
  );
  return result(
    params.platform,
    summarizeIssuePage(issues),
    "Issue bodies are omitted from list output; use forges_issues_get to read one body.",
  );
}

export async function searchIssues(
  params: SearchRepositoryIssuesParams,
): Promise<ForgesToolResult<SearchPageResult<Omit<Issue, "body">>>> {
  const issues = await readProvider(params.platform).issues.search(
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
  const issue = await readProvider(params.platform).issues.get(
    params.owner,
    params.repo,
    params.number,
  );
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
  const comments = await readProvider(params.platform).issues.listComments(
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
  const comment = await readProvider(params.platform).issues.getComment(
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
    const issue = await authenticatedProvider(params.platform).issues.create(
      params.owner,
      params.repo,
      {
        title: params.title,
        body: params.body,
        labels: params.labels,
        assignees: params.assignees,
      },
    );
    return result(params.platform, issue, assignmentNote(params.assignees, issue.assignees));
  });
}

export async function listPullRequests(
  params: ListRepositoryItemsParams,
): Promise<ForgesToolResult<PageResult<Omit<PullRequest, "body">>>> {
  const pullRequests = await readProvider(params.platform).pullRequests.list(
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
  const files = await readProvider(params.platform).pullRequests.listFiles(
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
  const checks = await readProvider(params.platform).pullRequests.listChecks(
    params.owner,
    params.repo,
    params.number,
    options,
  );
  return result(params.platform, checks);
}

export async function searchPullRequests(
  params: SearchRepositoryPullRequestsParams,
): Promise<ForgesToolResult<SearchPageResult<Omit<PullRequestSearchItem, "body">>>> {
  const pullRequests = await readProvider(params.platform).pullRequests.search(
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
  const pullRequest = await readProvider(params.platform).pullRequests.get(
    params.owner,
    params.repo,
    params.number,
  );
  return result(params.platform, pullRequest);
}

export async function listPullRequestComments(
  params: ListCommentsParams,
): Promise<ForgesToolResult<PageResult<Comment>>> {
  const comments = await readProvider(params.platform).pullRequests.listComments(
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
  const comment = await readProvider(params.platform).pullRequests.getComment(
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
    const pullRequest = await authenticatedProvider(params.platform).pullRequests.create(
      params.owner,
      params.repo,
      {
        title: params.title,
        body: params.body,
        sourceBranch: params.sourceBranch,
        targetBranch: params.targetBranch,
        draft: params.draft,
        assignees: params.assignees,
      },
    );
    return result(
      params.platform,
      pullRequest,
      assignmentNote(params.assignees, pullRequest.assignees),
    );
  });
}

export async function getUser(params: GetUserParams): Promise<ForgesToolResult<User>> {
  const user = await readProvider(params.platform).users.get(params.username);
  return result(params.platform, user);
}

function authenticatedUserResult(platform: ForgesPlatform): Promise<ForgesToolResult<User>> {
  return authenticatedProvider(platform)
    .users.authenticated()
    .then((user) => result(platform, user));
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
  const threads = await readProvider(params.platform).threads.list(
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
  const thread = await readProvider(params.platform).threads.get(
    params.owner,
    params.repo,
    params.number,
    params.threadId,
  );
  return result(params.platform, thread);
}

export function replyToThread(params: ReplyThreadParams): Promise<ForgesToolResult<ThreadComment>> {
  return withCredentialOperation(params.platform, async () => {
    const comment = await authenticatedProvider(params.platform).threads.reply(
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
    const thread = await authenticatedProvider(params.platform).threads.resolve(
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
    const thread = await authenticatedProvider(params.platform).threads.unresolve(
      params.owner,
      params.repo,
      params.number,
      params.threadId,
    );
    return result(params.platform, thread);
  });
}

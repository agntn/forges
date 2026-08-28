import { createProvider, resolveToken } from "./index.ts";
import { AuthenticationError } from "./errors.ts";
import type { ForgesPlatform } from "../packages/shared/forges-tool-schemas.ts";
import type { Provider } from "./provider.ts";
import type {
  Comment,
  CreateIssueInput,
  CreatePullRequestInput,
  Issue,
  IssueState,
  ListCommentOptions,
  ListOptions,
  ListThreadOptions,
  PageResult,
  PullRequest,
  ReplyThreadInput,
  Repository,
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

/** Drop every pinned provider so the next call resolves its access level again. */
export function resetPinnedProviders(): void {
  pinnedProviders.clear();
  anonymousReadProviders.clear();
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

export interface ListRepositoryItemsParams extends RepositoryParams {
  page?: number;
  perPage?: number;
  state?: IssueState | "all";
}

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
  const issue = await authenticatedProvider(params.platform).issues.create(
    params.owner,
    params.repo,
    {
      title: params.title,
      body: params.body,
      labels: params.labels,
    },
  );
  return result(params.platform, issue);
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
  const pullRequest = await authenticatedProvider(params.platform).pullRequests.create(
    params.owner,
    params.repo,
    {
      title: params.title,
      body: params.body,
      sourceBranch: params.sourceBranch,
      targetBranch: params.targetBranch,
      draft: params.draft,
    },
  );
  return result(params.platform, pullRequest);
}

export async function getUser(params: GetUserParams): Promise<ForgesToolResult<User>> {
  const user = await readProvider(params.platform).users.get(params.username);
  return result(params.platform, user);
}

export async function getAuthenticatedUser(
  params: PlatformParams,
): Promise<ForgesToolResult<User>> {
  const user = await authenticatedProvider(params.platform).users.authenticated();
  return result(params.platform, user);
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

export async function replyToThread(
  params: ReplyThreadParams,
): Promise<ForgesToolResult<ThreadComment>> {
  const comment = await authenticatedProvider(params.platform).threads.reply(
    params.owner,
    params.repo,
    params.number,
    params.threadId,
    { body: params.body },
  );
  return result(params.platform, comment);
}

export async function resolveThread(params: GetThreadParams): Promise<ForgesToolResult<Thread>> {
  const thread = await authenticatedProvider(params.platform).threads.resolve(
    params.owner,
    params.repo,
    params.number,
    params.threadId,
  );
  return result(params.platform, thread);
}

export async function unresolveThread(params: GetThreadParams): Promise<ForgesToolResult<Thread>> {
  const thread = await authenticatedProvider(params.platform).threads.unresolve(
    params.owner,
    params.repo,
    params.number,
    params.threadId,
  );
  return result(params.platform, thread);
}

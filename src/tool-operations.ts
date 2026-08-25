import { createProvider } from "./index.ts";
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

function createConfiguredProvider(platform: ForgesPlatform): Provider {
  const baseURL = process.env[baseUrlEnvByPlatform[platform]];
  return createProvider(platform, baseURL === undefined ? undefined : { baseURL });
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

function result<T>(
  platform: ForgesPlatform,
  value: T,
  modelValue: unknown = value,
  note?: string,
): ForgesToolResult<T> {
  const details = { platform, result: value };
  const modelDetails = note
    ? { platform, result: modelValue, note }
    : { platform, result: modelValue };
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
  const repositories = await createConfiguredProvider(params.platform).repos.list(
    params.owner,
    listOptions(params),
  );
  return result(params.platform, repositories);
}

export async function getRepository(
  params: GetRepositoryParams,
): Promise<ForgesToolResult<Repository>> {
  const repository = await createConfiguredProvider(params.platform).repos.get(
    params.owner,
    params.repo,
  );
  return result(params.platform, repository);
}

export async function listIssues(
  params: ListRepositoryItemsParams,
): Promise<ForgesToolResult<PageResult<Issue>>> {
  const issues = await createConfiguredProvider(params.platform).issues.list(
    params.owner,
    params.repo,
    listOptions(params),
  );
  return result(
    params.platform,
    issues,
    summarizeIssuePage(issues),
    "Issue bodies are omitted from list output; use forges_issues_get to read one body.",
  );
}

export async function getIssue(params: GetRepositoryItemParams): Promise<ForgesToolResult<Issue>> {
  const issue = await createConfiguredProvider(params.platform).issues.get(
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
  const comments = await createConfiguredProvider(params.platform).issues.listComments(
    params.owner,
    params.repo,
    params.number,
    commentListOptions(params),
  );
  return result(
    params.platform,
    comments,
    summarizeCommentPage(comments),
    "Comment bodies are truncated in list output; use forges_issues_comments_get to read one in full.",
  );
}

export async function getIssueComment(
  params: GetCommentParams,
): Promise<ForgesToolResult<Comment>> {
  const comment = await createConfiguredProvider(params.platform).issues.getComment(
    params.owner,
    params.repo,
    params.number,
    params.commentId,
  );
  return result(params.platform, comment);
}

export async function createIssue(params: CreateIssueParams): Promise<ForgesToolResult<Issue>> {
  const issue = await createConfiguredProvider(params.platform).issues.create(
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
): Promise<ForgesToolResult<PageResult<PullRequest>>> {
  const pullRequests = await createConfiguredProvider(params.platform).pullRequests.list(
    params.owner,
    params.repo,
    listOptions(params),
  );
  return result(
    params.platform,
    pullRequests,
    summarizeIssuePage(pullRequests),
    "Pull-request bodies are omitted from list output; use forges_pull_requests_get to read one body.",
  );
}

export async function getPullRequest(
  params: GetRepositoryItemParams,
): Promise<ForgesToolResult<PullRequest>> {
  const pullRequest = await createConfiguredProvider(params.platform).pullRequests.get(
    params.owner,
    params.repo,
    params.number,
  );
  return result(params.platform, pullRequest);
}

export async function listPullRequestComments(
  params: ListCommentsParams,
): Promise<ForgesToolResult<PageResult<Comment>>> {
  const comments = await createConfiguredProvider(params.platform).pullRequests.listComments(
    params.owner,
    params.repo,
    params.number,
    commentListOptions(params),
  );
  return result(
    params.platform,
    comments,
    summarizeCommentPage(comments),
    "Comment bodies are truncated in list output; use forges_pull_requests_comments_get to read one in full.",
  );
}

export async function getPullRequestComment(
  params: GetCommentParams,
): Promise<ForgesToolResult<Comment>> {
  const comment = await createConfiguredProvider(params.platform).pullRequests.getComment(
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
  const pullRequest = await createConfiguredProvider(params.platform).pullRequests.create(
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
  const user = await createConfiguredProvider(params.platform).users.get(params.username);
  return result(params.platform, user);
}

export async function getAuthenticatedUser(
  params: PlatformParams,
): Promise<ForgesToolResult<User>> {
  const user = await createConfiguredProvider(params.platform).users.authenticated();
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
  const threads = await createConfiguredProvider(params.platform).threads.list(
    params.owner,
    params.repo,
    params.number,
    threadListOptions(params),
  );
  return result(
    params.platform,
    threads,
    summarizeThreadPage(threads),
    "Comment bodies are truncated in list output; use forges_threads_get to read one full thread.",
  );
}

export async function getThread(params: GetThreadParams): Promise<ForgesToolResult<Thread>> {
  const thread = await createConfiguredProvider(params.platform).threads.get(
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
  const comment = await createConfiguredProvider(params.platform).threads.reply(
    params.owner,
    params.repo,
    params.number,
    params.threadId,
    { body: params.body },
  );
  return result(params.platform, comment);
}

export async function resolveThread(params: GetThreadParams): Promise<ForgesToolResult<Thread>> {
  const thread = await createConfiguredProvider(params.platform).threads.resolve(
    params.owner,
    params.repo,
    params.number,
    params.threadId,
  );
  return result(params.platform, thread);
}

export async function unresolveThread(params: GetThreadParams): Promise<ForgesToolResult<Thread>> {
  const thread = await createConfiguredProvider(params.platform).threads.unresolve(
    params.owner,
    params.repo,
    params.number,
    params.threadId,
  );
  return result(params.platform, thread);
}

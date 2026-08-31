import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { ForgesError, RateLimitError } from "./errors.ts";
import {
  authenticatedUserParameters,
  codeSearchParameters,
  commentParameters,
  commitParameters,
  contributionTemplateParameters,
  createIssueParameters,
  createPullRequestParameters,
  listCiRunsParameters,
  listCommentsParameters,
  listCommitsParameters,
  listContributionTemplatesParameters,
  listPullRequestChecksParameters,
  listPullRequestFilesParameters,
  listRepositoriesParameters,
  listRepositoryItemsParameters,
  listThreadsParameters,
  replyThreadParameters,
  repositoryItemParameters,
  repositoryParameters,
  searchRepositoryItemsParameters,
  threadParameters,
  userParameters,
} from "../packages/shared/forges-tool-schemas.ts";
import {
  createIssue,
  createPullRequest,
  getAuthenticatedUser,
  getCommit,
  getContributionTemplate,
  getIssue,
  getIssueComment,
  getPullRequest,
  getPullRequestComment,
  getRepository,
  getThread,
  getUser,
  listCiRuns,
  listCommits,
  listContributionTemplates,
  listIssueComments,
  listIssues,
  listPullRequestChecks,
  listPullRequestComments,
  listPullRequestFiles,
  listPullRequests,
  listRepositories,
  listThreads,
  reloadAuthentication,
  replyToThread,
  searchCode,
  searchIssues,
  searchPullRequests,
  resolveThread,
  unresolveThread,
  type ForgesToolResult,
} from "./tool-operations.ts";
import { version } from "./version.ts";

interface ToolDefinition<S extends TSchema = TSchema> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  annotations: Tool["annotations"];
  /**
   * Declared as a function property, not a method: TypeScript compares method
   * parameters bivariantly, which would let an executor demanding fields the
   * schema does not declare pass unnoticed.
   */
  execute: (args: Static<S>) => Promise<ForgesToolResult<unknown>>;
}

/**
 * Binds one tool's executor to its own schema.
 *
 * Without the generic, `execute` would take `Record<string, unknown>` and every
 * entry would need a cast — which is what lets a schema sit next to the wrong
 * executor and only fail when a provider receives an undefined field. The single
 * cast here is where that schema type is erased for the uniform tool table.
 */
function defineTool<S extends TSchema>(tool: ToolDefinition<S>): ToolDefinition {
  return tool as ToolDefinition;
}

/** Every operation crosses the network to a hosted Git platform, so nothing is closed-world. */
const readAnnotations: Tool["annotations"] = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
/** Creating an issue, a pull request, or a reply twice leaves two of them behind. */
const createAnnotations: Tool["annotations"] = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
/** A repeated reload can adopt a different local account, so clients must not retry it blindly. */
const credentialStateAnnotations: Tool["annotations"] = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
/** Resolving an already resolved thread changes nothing and destroys nothing. */
const threadStateAnnotations: Tool["annotations"] = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const tools: ToolDefinition[] = [
  defineTool({
    name: "forges_repos_list",
    title: "List Repositories",
    description:
      "List the repositories owned by one user or organization on GitHub, GitLab, Gitea, or Forgejo, normalized to one shape. Results are paged: read hasNextPage and nextPage instead of assuming the first page is everything.",
    inputSchema: listRepositoriesParameters,
    annotations: readAnnotations,
    execute: listRepositories,
  }),
  defineTool({
    name: "forges_repos_get",
    title: "Get Repository",
    description:
      "Get one repository by owner and name, normalized across platforms: description, visibility, default branch, fork parent, viewer permission, web and clone URL, and owner. A null viewerPermission means the platform omitted access metadata.",
    inputSchema: repositoryParameters,
    annotations: readAnnotations,
    execute: getRepository,
  }),
  defineTool({
    name: "forges_contribution_templates_list",
    title: "List Contribution Templates",
    description:
      "List paged metadata for the effective issue or pull-request templates of one repository. Results identify local versus inherited files and their source when the platform exposes it. Bodies are omitted; pass the returned kind and key unchanged to forges_contribution_templates_get.",
    inputSchema: listContributionTemplatesParameters,
    annotations: readAnnotations,
    execute: listContributionTemplates,
  }),
  defineTool({
    name: "forges_contribution_templates_get",
    title: "Get Contribution Template",
    description:
      "Get the full source body of one effective issue or pull-request template. Use the exact kind and provider key returned by forges_contribution_templates_list.",
    inputSchema: contributionTemplateParameters,
    annotations: readAnnotations,
    execute: getContributionTemplate,
  }),
  defineTool({
    name: "forges_code_search",
    title: "Search Repository Code",
    description:
      "Search code across repositories, optionally scoped to an owner or one repository. Results contain normalized repository names, paths, and web URLs. Results are paged, and incomplete says whether the search is known to be partial. GitLab requires authentication, and its global or group code search requires Premium or Ultimate with advanced or exact code search. Gitea, Forgejo, and GitHub-compatible hosts without the endpoint return an explicit unsupported error.",
    inputSchema: codeSearchParameters,
    annotations: readAnnotations,
    execute: searchCode,
  }),
  defineTool({
    name: "forges_ci_runs_list",
    title: "List CI Runs",
    description:
      "List paged repository CI runs, normalized from GitHub Actions, GitLab pipelines, and Gitea Actions. Each run includes its branch, revision SHA, lifecycle status, terminal conclusion, and web URL. Filter by branch when checking whether a specific line of development is green.",
    inputSchema: listCiRunsParameters,
    annotations: readAnnotations,
    execute: listCiRuns,
  }),
  defineTool({
    name: "forges_commits_list",
    title: "List Commits",
    description:
      "List paged commit summaries for one repository, optionally filtered by ref, path, and ISO-8601 since/until dates. Summaries omit changed-file rows; use forges_commits_get for one commit's files. Gitea rejects path because its API ignores pagination limits for that filter.",
    inputSchema: listCommitsParameters,
    annotations: readAnnotations,
    execute: listCommits,
  }),
  defineTool({
    name: "forges_commits_get",
    title: "Get Commit",
    description:
      "Get one commit by SHA with normalized author, committer, parent revisions, message, URL, and changed-file rows. Patches are omitted; per-file counts are null when the provider does not report them, and filesComplete is null when provider or safety limits make completeness unknowable.",
    inputSchema: commitParameters,
    annotations: readAnnotations,
    execute: getCommit,
  }),
  defineTool({
    name: "forges_issues_list",
    title: "List Issues",
    description:
      "List normalized issues for one repository, optionally filtered by state. Issue bodies are omitted here so one page cannot flood the context; read a single body with forges_issues_get. GitHub serves pull requests from the same endpoint and they are dropped after the page is cut, so an empty page whose hasNextPage is true means keep paging — not that the repository has no issues.",
    inputSchema: listRepositoryItemsParameters,
    annotations: readAnnotations,
    execute: listIssues,
  }),
  defineTool({
    name: "forges_issues_search",
    title: "Search Issues",
    description:
      "Search issues inside one repository with the selected platform's query syntax, optionally filtered by state. Bodies are omitted; read one result with forges_issues_get. Results are paged, and incomplete says whether the search is known to be partial.",
    inputSchema: searchRepositoryItemsParameters,
    annotations: readAnnotations,
    execute: searchIssues,
  }),
  defineTool({
    name: "forges_issues_get",
    title: "Get Issue",
    description:
      "Get one issue by number, including its body. The number is the one the web UI shows, which on GitLab is the project-scoped iid rather than the global id.",
    inputSchema: repositoryItemParameters,
    annotations: readAnnotations,
    execute: getIssue,
  }),
  defineTool({
    name: "forges_issues_comments",
    title: "List Issue Comments",
    description:
      "List the discussion comments under one issue, oldest first. Comment bodies are truncated here; read one whole with forges_issues_comments_get. Ask for a small perPage on a busy issue and follow hasNextPage. GitLab system notes about label and state churn are dropped, so a short page whose hasNextPage is true means keep paging, not that the discussion ended.",
    inputSchema: listCommentsParameters,
    annotations: readAnnotations,
    execute: listIssueComments,
  }),
  defineTool({
    name: "forges_issues_comments_get",
    title: "Get Issue Comment",
    description:
      "Get one discussion comment under an issue, with its full body. The id is the one forges_issues_comments returned for it.",
    inputSchema: commentParameters,
    annotations: readAnnotations,
    execute: getIssueComment,
  }),
  defineTool({
    name: "forges_issues_create",
    title: "Create Issue",
    description:
      "Create an issue in one repository. This writes to the hosted platform as the account the local credentials belong to, so confirm the target with the user first; forges_users_authenticated names that account.",
    inputSchema: createIssueParameters,
    annotations: createAnnotations,
    execute: createIssue,
  }),
  defineTool({
    name: "forges_pull_requests_list",
    title: "List Pull Requests",
    description:
      "List normalized pull requests, which GitLab calls merge requests, for one repository, optionally filtered by state. Bodies are omitted here; read a single body with forges_pull_requests_get.",
    inputSchema: listRepositoryItemsParameters,
    annotations: readAnnotations,
    execute: listPullRequests,
  }),
  defineTool({
    name: "forges_pull_requests_search",
    title: "Search Pull Requests",
    description:
      "Search pull requests inside one repository with the selected platform's query syntax, optionally filtered by state. Bodies and revision details are omitted; read one result with forges_pull_requests_get. Results are paged, and incomplete says whether the search is known to be partial.",
    inputSchema: searchRepositoryItemsParameters,
    annotations: readAnnotations,
    execute: searchPullRequests,
  }),
  defineTool({
    name: "forges_pull_requests_get",
    title: "Get Pull Request",
    description:
      "Get one pull request, called a merge request on GitLab, by number: body, branches, head revision, draft and merged state, mergeability, provider merge status, and the landed merge commit SHA.",
    inputSchema: repositoryItemParameters,
    annotations: readAnnotations,
    execute: getPullRequest,
  }),
  defineTool({
    name: "forges_pull_requests_files",
    title: "List Pull Request Files",
    description:
      "List files changed by one pull request, normalized to path, status, additions, and deletions. Patches are omitted. GitLab counts are null when it withholds a collapsed or oversized diff.",
    inputSchema: listPullRequestFilesParameters,
    annotations: readAnnotations,
    execute: listPullRequestFiles,
  }),
  defineTool({
    name: "forges_pull_requests_checks",
    title: "List Pull Request Checks",
    description:
      "List the checks or pipelines associated with one pull request head revision, normalized to name, lifecycle status, terminal conclusion, and URL.",
    inputSchema: listPullRequestChecksParameters,
    annotations: readAnnotations,
    execute: listPullRequestChecks,
  }),
  defineTool({
    name: "forges_pull_requests_comments",
    title: "List Pull Request Comments",
    description:
      "List the conversation comments under one pull request, oldest first: the discussion, not the code-review threads that forges_threads_list reads. Comment bodies are truncated here; read one whole with forges_pull_requests_comments_get, and bound the volume with perPage and hasNextPage.",
    inputSchema: listCommentsParameters,
    annotations: readAnnotations,
    execute: listPullRequestComments,
  }),
  defineTool({
    name: "forges_pull_requests_comments_get",
    title: "Get Pull Request Comment",
    description:
      "Get one conversation comment under a pull request, with its full body. The id is the one forges_pull_requests_comments returned; review-thread comments come back whole from forges_threads_get instead.",
    inputSchema: commentParameters,
    annotations: readAnnotations,
    execute: getPullRequestComment,
  }),
  defineTool({
    name: "forges_pull_requests_create",
    title: "Create Pull Request",
    description:
      "Open a pull request, a GitLab merge request, from one branch onto another. This writes to the hosted platform as the account the local credentials belong to, so confirm the branches and the target with the user first.",
    inputSchema: createPullRequestParameters,
    annotations: createAnnotations,
    execute: createPullRequest,
  }),
  defineTool({
    name: "forges_users_get",
    title: "Get User",
    description:
      "Get one normalized user profile by username: display name, bio, company, location, website, follower counts, account creation date, profile URL, email, avatar URL, admin flag, and platform id.",
    inputSchema: userParameters,
    annotations: readAnnotations,
    execute: getUser,
  }),
  defineTool({
    name: "forges_users_authenticated",
    title: "Get Authenticated User",
    description:
      "Get the profile of the account the locally detected credentials belong to. Call this before writing anything, because every write lands under that account and the server never takes a token as an argument. The credential stays pinned until forges_auth_reload explicitly replaces it.",
    inputSchema: authenticatedUserParameters,
    annotations: readAnnotations,
    execute: getAuthenticatedUser,
  }),
  defineTool({
    name: "forges_auth_reload",
    title: "Reload Authentication",
    description:
      "Replace the local credential pinned for one platform, then return the newly authenticated profile. This changes server state but writes nothing to the Git host.",
    inputSchema: authenticatedUserParameters,
    annotations: credentialStateAnnotations,
    execute: reloadAuthentication,
  }),
  defineTool({
    name: "forges_threads_list",
    title: "List Review Threads",
    description:
      "List the review threads on one pull request, optionally filtered by resolved state. Comment bodies are truncated here; read one thread whole with forges_threads_get. Gitea carries no parent id on review comments, so each comment comes back as its own single-comment thread there.",
    inputSchema: listThreadsParameters,
    annotations: readAnnotations,
    execute: listThreads,
  }),
  defineTool({
    name: "forges_threads_get",
    title: "Get Review Thread",
    description:
      "Get one review thread by the exact id that forges_threads_list returned, with every comment body in full. Thread ids are platform-specific opaque strings, so never construct one.",
    inputSchema: threadParameters,
    annotations: readAnnotations,
    execute: getThread,
  }),
  defineTool({
    name: "forges_threads_reply",
    title: "Reply to Review Thread",
    description:
      "Post a reply inside an existing review thread, keeping the answer attached to the code it discusses instead of adding a standalone pull-request comment. This writes to the hosted platform under the local credentials.",
    inputSchema: replyThreadParameters,
    annotations: createAnnotations,
    execute: replyToThread,
  }),
  defineTool({
    name: "forges_threads_resolve",
    title: "Resolve Review Thread",
    description:
      "Mark one review thread resolved. This writes to the hosted platform under the local credentials, so resolve a thread only after the point it raised has actually been addressed.",
    inputSchema: threadParameters,
    annotations: threadStateAnnotations,
    execute: resolveThread,
  }),
  defineTool({
    name: "forges_threads_unresolve",
    title: "Unresolve Review Thread",
    description:
      "Reopen one resolved review thread. This writes to the hosted platform under the local credentials.",
    inputSchema: threadParameters,
    annotations: threadStateAnnotations,
    execute: unresolveThread,
  }),
];

/** Formats the first TypeBox validation failure for an MCP client. */
function validationError(schema: TSchema, value: unknown): string {
  const first = Value.Errors(schema, value)[0];
  if (!first) return "Invalid arguments";
  return `Invalid arguments at ${first.instancePath || "/"}: ${first.message}`;
}

/**
 * Converts a shared tool result to the MCP text-result contract.
 *
 * `details` is dropped and `structuredContent` is never set: clients that see
 * structured output prefer it over `content` and would hide the readable answer,
 * which for list operations is the bounded one the text already carries.
 */
function toCallToolResult(result: ForgesToolResult<unknown>): CallToolResult {
  return { content: result.content };
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * ofetch formats every FetchError message as `[METHOD] "<absolute url>": …` and
 * `normalizeError` keeps that text, so passing it straight through would hand the
 * model the `FORGES_*_BASE_URL` the tool surface deliberately withholds — along
 * with any credentials an operator put in it. The request line goes; a URL left
 * anywhere else in the message becomes a placeholder. Text a provider authored
 * carries no endpoint and survives untouched.
 */
const REQUEST_LINE = /\[[A-Z]+\] "[^"]*":\s*/g;
const ABSOLUTE_URL = /\b[a-z][\w+.-]*:\/\/\S+/gi;

function redactEndpoint(message: string): string {
  return message.replace(REQUEST_LINE, "").replace(ABSOLUTE_URL, "<endpoint>").trim();
}

/**
 * Builds the model-facing failure line.
 *
 * The retry window is appended because it is the one field an agent can act on
 * that the message itself never carries.
 */
function failureText(name: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const status = error instanceof ForgesError ? error.status : undefined;
  const reason =
    redactEndpoint(raw) || (status === undefined ? "no reason reported" : `HTTP ${status}`);
  const retry =
    error instanceof RateLimitError && error.retryAfter !== undefined
      ? ` Retry after ${error.retryAfter}s.`
      : "";
  return `${name} failed: ${reason}${retry}`;
}

/**
 * Creates an unconnected MCP server exposing repository, CI-run, issue,
 * pull-request, user, and review-thread tools.
 *
 * Built on the low-level `Server` even though the SDK marks it `@deprecated`,
 * because `McpServer.registerTool` accepts Standard Schema (Zod) only. TypeBox 1.x
 * does not implement Standard Schema, and this package's tool schemas are TypeBox,
 * shared with the Pi extension. The high-level API would force a second definition
 * of every parameter.
 *
 * Tokens and endpoints stay out of the tool surface: credentials come from the
 * local detection chain and self-hosted endpoints from the `FORGES_*_BASE_URL`
 * variables of the server process.
 */
export function createMcpServer(): Server {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const server = new Server({ name: "forges", version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool): Tool => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as Tool["inputSchema"],
      annotations: tool.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolsByName.get(request.params.name);
    if (!tool) return errorResult(`Unknown forges tool: ${request.params.name}`);

    const args = request.params.arguments ?? {};
    if (!Value.Check(tool.inputSchema, args)) {
      return errorResult(validationError(tool.inputSchema, args));
    }

    try {
      return toCallToolResult(await tool.execute(args));
    } catch (error) {
      return errorResult(failureText(tool.name, error));
    }
  });

  return server;
}

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
  createIssueParameters,
  createPullRequestParameters,
  listCommentsParameters,
  listRepositoriesParameters,
  listRepositoryItemsParameters,
  listThreadsParameters,
  replyThreadParameters,
  repositoryItemParameters,
  repositoryParameters,
  threadParameters,
  userParameters,
} from "../packages/shared/forges-tool-schemas.ts";
import {
  createIssue,
  createPullRequest,
  getAuthenticatedUser,
  getIssue,
  getPullRequest,
  getRepository,
  getThread,
  getUser,
  listIssueComments,
  listIssues,
  listPullRequestComments,
  listPullRequests,
  listRepositories,
  listThreads,
  replyToThread,
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
      "Get one repository by owner and name, normalized across platforms: description, visibility, default branch, web and clone URL, and owner.",
    inputSchema: repositoryParameters,
    annotations: readAnnotations,
    execute: getRepository,
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
      "List the discussion comments under one issue, oldest first, with full bodies. Ask for a small perPage on a busy issue and follow hasNextPage. GitLab system notes about label and state churn are dropped, so a short page whose hasNextPage is true means keep paging, not that the discussion ended.",
    inputSchema: listCommentsParameters,
    annotations: readAnnotations,
    execute: listIssueComments,
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
    name: "forges_pull_requests_get",
    title: "Get Pull Request",
    description:
      "Get one pull request, a GitLab merge request, by number: body, source and target branch, and the draft and merged flags.",
    inputSchema: repositoryItemParameters,
    annotations: readAnnotations,
    execute: getPullRequest,
  }),
  defineTool({
    name: "forges_pull_requests_comments",
    title: "List Pull Request Comments",
    description:
      "List the conversation comments under one pull request, oldest first: the discussion, not the code-review threads that forges_threads_list reads. Full bodies, so bound the volume with perPage and follow hasNextPage.",
    inputSchema: listCommentsParameters,
    annotations: readAnnotations,
    execute: listPullRequestComments,
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
      "Get one normalized user profile by username: display name, email, avatar URL, admin flag, and platform id.",
    inputSchema: userParameters,
    annotations: readAnnotations,
    execute: getUser,
  }),
  defineTool({
    name: "forges_users_authenticated",
    title: "Get Authenticated User",
    description:
      "Get the profile of the account the locally detected credentials belong to. Call this before writing anything, because every write lands under that account and the server never takes a token as an argument.",
    inputSchema: authenticatedUserParameters,
    annotations: readAnnotations,
    execute: getAuthenticatedUser,
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
 * Creates an unconnected MCP server exposing the repository, issue, pull-request,
 * user, and review-thread tools.
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
    tools: tools.map(
      (tool): Tool => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema as Tool["inputSchema"],
        annotations: tool.annotations,
      }),
    ),
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

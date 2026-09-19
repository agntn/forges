import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Static, TObject } from "typebox";
import type { ForgesToolSchemas } from "../packages/shared/forges-tool-schemas.ts";
import type * as ToolOperations from "./tool-operations.ts";
import type { ForgesToolResult } from "./tool-operations.ts";
import { version } from "./version.ts";
import { lazy } from "../packages/shared/lazy.ts";
import { forgeToolTitle } from "../packages/shared/tui.ts";

/** The executors every tool binds to, loaded on the first call rather than at import. */
type Operations = typeof ToolOperations;

interface ToolDefinition<S extends TObject = TObject> {
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
  execute: (operations: Operations, args: Static<S>) => Promise<ForgesToolResult<unknown>>;
}

/**
 * Binds one tool's executor to its own schema.
 *
 * Without the generic, `execute` would take `Record<string, unknown>` and every
 * entry would need a cast — which is what lets a schema sit next to the wrong
 * executor and only fail when a provider receives an undefined field. The single
 * cast here is where that schema type is erased for the uniform tool table.
 */
function defineTool<S extends TObject>(tool: ToolDefinition<S>): ToolDefinition {
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
/** Sending the same edit twice leaves one release, but the old title and notes are gone. */
const updateAnnotations: Tool["annotations"] = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
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

/**
 * The tool table, built once per server from freshly constructed schemas.
 *
 * Nothing here runs at import: the schemas need TypeBox and the executors need
 * the provider graph, and both load when the first request asks for them.
 */
function defineTools(schemas: ForgesToolSchemas): ToolDefinition[] {
  return [
    defineTool({
      name: "forges_repos_list",
      title: "List Repositories",
      description:
        "List the repositories owned by one user or organization on GitHub, GitLab, Gitea, or Forgejo, normalized to one shape. Results are paged: read hasNextPage and nextPage instead of assuming the first page is everything.",
      inputSchema: schemas.listRepositoriesParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.listRepositories(args),
    }),
    defineTool({
      name: "forges_repos_get",
      title: "Get Repository",
      description:
        "Get one repository by owner and name, normalized across platforms: description, visibility, default branch, fork parent, viewer permission, web and clone URL, and owner. A null viewerPermission means the platform omitted access metadata.",
      inputSchema: schemas.repositoryParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.getRepository(args),
    }),
    defineTool({
      name: "forges_contribution_templates_list",
      title: "List Contribution Templates",
      description:
        "List paged metadata for the effective issue or pull-request templates of one repository. Results identify local versus inherited files and their source when the platform exposes it. Bodies are omitted; pass the returned kind and key unchanged to forges_contribution_templates_get.",
      inputSchema: schemas.listContributionTemplatesParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.listContributionTemplates(args),
    }),
    defineTool({
      name: "forges_contribution_templates_get",
      title: "Get Contribution Template",
      description:
        "Get the full source body of one effective issue or pull-request template. Use the exact kind and provider key returned by forges_contribution_templates_list.",
      inputSchema: schemas.contributionTemplateParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.getContributionTemplate(args),
    }),
    defineTool({
      name: "forges_code_search",
      title: "Search Repository Code",
      description:
        "Search code across repositories, optionally scoped to an owner or one repository. Results contain normalized repository names, paths, and web URLs. Results are paged, and incomplete says whether the search is known to be partial. GitLab requires authentication, and its global or group code search requires Premium or Ultimate with advanced or exact code search. Gitea, Forgejo, and GitHub-compatible hosts without the endpoint return an explicit unsupported error.",
      inputSchema: schemas.codeSearchParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.searchCode(args),
    }),
    defineTool({
      name: "forges_ci_runs_list",
      title: "List CI Runs",
      description:
        "List paged repository CI runs, normalized from GitHub Actions, GitLab pipelines, and Gitea Actions. Each run includes its branch, revision SHA, lifecycle status, terminal conclusion, and web URL. Filter by branch when checking whether a specific line of development is green.",
      inputSchema: schemas.listCiRunsParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.listCiRuns(args),
    }),
    defineTool({
      name: "forges_commits_list",
      title: "List Commits",
      description:
        "List paged commit summaries for one repository, optionally filtered by ref, path, and ISO-8601 since/until dates. Summaries omit changed-file rows; use forges_commits_get for one commit's files. Gitea rejects path because that API ignores pagination limits for the filter; Forgejo paginates it.",
      inputSchema: schemas.listCommitsParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.listCommits(args),
    }),
    defineTool({
      name: "forges_commits_get",
      title: "Get Commit",
      description:
        "Get one commit by SHA with normalized author, committer, parent revisions, message, URL, and changed-file rows. Patches are omitted; per-file counts are null when the provider does not report them, and filesComplete is null when provider or safety limits make completeness unknowable.",
      inputSchema: schemas.commitParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.getCommit(args),
    }),
    defineTool({
      name: "forges_releases_list",
      title: "List Releases",
      description:
        "List the releases of one repository, newest first, each with its tag, title, draft and pre-release flags, author, creation and publication time, and URL. Release notes are omitted here; read one with forges_releases_get. Drafts appear only for a token with push access, and GitLab has neither drafts nor pre-releases, so both flags are false there.",
      inputSchema: schemas.listReleasesParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.listReleases(args),
    }),
    defineTool({
      name: "forges_releases_get",
      title: "Get Release",
      description:
        "Get one release by its tag name with the full release notes. The tag is the key on every platform, because GitLab releases have no id of their own; the id field is the platform id on GitHub and Gitea and the tag on GitLab. A GitHub draft is found among the 500 newest releases when the token may see drafts.",
      inputSchema: schemas.releaseParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.getRelease(args),
    }),
    defineTool({
      name: "forges_releases_create",
      title: "Create Release",
      description:
        "Create a release for a tag, creating the tag from ref when it does not exist yet. A release that is not a draft is public the moment it lands and notifies watchers, so confirm the tag, the notes, and the target with the user first; this writes as the account the local credentials belong to. GitLab has no drafts or pre-releases and rejects either flag set to true instead of publishing.",
      inputSchema: schemas.createReleaseParameters,
      annotations: createAnnotations,
      execute: (operations, args) => operations.createRelease(args),
    }),
    defineTool({
      name: "forges_releases_update",
      title: "Update Release",
      description:
        "Update the title, notes, draft or pre-release flag of the release behind one tag. Pass at least one of them; omitted fields keep their value. This overwrites what is there and writes as the account the local credentials belong to, so read the release first and confirm the new text with the user. A GitHub draft is found the way forges_releases_get finds it, among the 500 newest releases. GitLab rejects draft or prerelease set to true.",
      inputSchema: schemas.updateReleaseParameters,
      annotations: updateAnnotations,
      execute: (operations, args) => operations.updateRelease(args),
    }),
    defineTool({
      name: "forges_issues_list",
      title: "List Issues",
      description:
        "List normalized issues for one repository, optionally filtered by state. Issue bodies are omitted here so one page cannot flood the context; read a single body with forges_issues_get. GitHub serves pull requests from the same endpoint and they are dropped after the page is cut, so an empty page whose hasNextPage is true means keep paging — not that the repository has no issues.",
      inputSchema: schemas.listRepositoryItemsParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.listIssues(args),
    }),
    defineTool({
      name: "forges_issues_search",
      title: "Search Issues",
      description:
        "Search issues inside one repository with the selected platform's query syntax, optionally filtered by state. Bodies are omitted; read one result with forges_issues_get. Results are paged, and incomplete says whether the search is known to be partial.",
      inputSchema: schemas.searchRepositoryItemsParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.searchIssues(args),
    }),
    defineTool({
      name: "forges_issues_get",
      title: "Get Issue",
      description:
        "Get one issue by number, including its body. The number is the one the web UI shows, which on GitLab is the project-scoped iid rather than the global id.",
      inputSchema: schemas.repositoryItemParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.getIssue(args),
    }),
    defineTool({
      name: "forges_issues_comments",
      title: "List Issue Comments",
      description:
        "List the discussion comments under one issue, oldest first. Comment bodies are truncated here; read one whole with forges_issues_comments_get. Ask for a small perPage on a busy issue and follow hasNextPage. GitLab system notes about label and state churn are dropped, so a short page whose hasNextPage is true means keep paging, not that the discussion ended.",
      inputSchema: schemas.listCommentsParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.listIssueComments(args),
    }),
    defineTool({
      name: "forges_issues_comments_get",
      title: "Get Issue Comment",
      description:
        "Get one discussion comment under an issue, with its full body. The id is the one forges_issues_comments returned for it.",
      inputSchema: schemas.commentParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.getIssueComment(args),
    }),
    defineTool({
      name: "forges_issues_create",
      title: "Create Issue",
      description:
        "Create an issue in one repository. This writes to the hosted platform as the account the local credentials belong to, so confirm the target with the user first; forges_users_authenticated names that account.",
      inputSchema: schemas.createIssueParameters,
      annotations: createAnnotations,
      execute: (operations, args) => operations.createIssue(args),
    }),
    defineTool({
      name: "forges_pull_requests_list",
      title: "List Pull Requests",
      description:
        "List normalized pull requests, which GitLab calls merge requests, for one repository, optionally filtered by state. Bodies are omitted here; read a single body with forges_pull_requests_get.",
      inputSchema: schemas.listRepositoryItemsParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.listPullRequests(args),
    }),
    defineTool({
      name: "forges_pull_requests_search",
      title: "Search Pull Requests",
      description:
        "Search pull requests inside one repository with the selected platform's query syntax, optionally filtered by state. Bodies and revision details are omitted; read one result with forges_pull_requests_get. Results are paged, and incomplete says whether the search is known to be partial.",
      inputSchema: schemas.searchRepositoryItemsParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.searchPullRequests(args),
    }),
    defineTool({
      name: "forges_pull_requests_get",
      title: "Get Pull Request",
      description:
        "Get one pull request, called a merge request on GitLab, by number: body, branches, head revision, draft and merged state, mergeability, provider merge status, and the landed merge commit SHA.",
      inputSchema: schemas.repositoryItemParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.getPullRequest(args),
    }),
    defineTool({
      name: "forges_pull_requests_files",
      title: "List Pull Request Files",
      description:
        "List files changed by one pull request, normalized to path, status, additions, and deletions. Patches are omitted. GitLab counts are null when it withholds a collapsed or oversized diff.",
      inputSchema: schemas.listPullRequestFilesParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.listPullRequestFiles(args),
    }),
    defineTool({
      name: "forges_pull_requests_checks",
      title: "List Pull Request Checks",
      description:
        "List the checks or pipelines associated with one pull request head revision, normalized to name, lifecycle status, terminal conclusion, and URL. On GitHub the rows are the commit statuses followed by the check runs, so a CLA bot or a Jenkins job that branch protection requires is listed too. On GitLab they are the merge request pipelines on the head plus its head_pipeline, which is how a merged results or merge train pipeline is found.",
      inputSchema: schemas.listPullRequestChecksParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.listPullRequestChecks(args),
    }),
    defineTool({
      name: "forges_pull_requests_reviews",
      title: "List Pull Request Reviews",
      description:
        "List the reviews given on one pull request, each normalized to approved, changes_requested, commented, dismissed, or pending, with its author, body, reviewed revision, time, and URL. Unanswered review requests are left out, and GitLab entries are its approvals plus each reviewer's stance. Bodies are truncated here; the inline comments of a review are the threads forges_threads_list reads.",
      inputSchema: schemas.listPullRequestReviewsParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.listPullRequestReviews(args),
    }),
    defineTool({
      name: "forges_pull_requests_comments",
      title: "List Pull Request Comments",
      description:
        "List the conversation comments under one pull request, oldest first: the discussion, not the code-review threads that forges_threads_list reads. Comment bodies are truncated here; read one whole with forges_pull_requests_comments_get, and bound the volume with perPage and hasNextPage.",
      inputSchema: schemas.listCommentsParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.listPullRequestComments(args),
    }),
    defineTool({
      name: "forges_pull_requests_comments_get",
      title: "Get Pull Request Comment",
      description:
        "Get one conversation comment under a pull request, with its full body. The id is the one forges_pull_requests_comments returned; review-thread comments come back whole from forges_threads_get instead.",
      inputSchema: schemas.commentParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.getPullRequestComment(args),
    }),
    defineTool({
      name: "forges_pull_requests_create",
      title: "Create Pull Request",
      description:
        "Open a pull request, a GitLab merge request, from one branch onto another. This writes to the hosted platform as the account the local credentials belong to, so confirm the branches and the target with the user first.",
      inputSchema: schemas.createPullRequestParameters,
      annotations: createAnnotations,
      execute: (operations, args) => operations.createPullRequest(args),
    }),
    defineTool({
      name: "forges_users_get",
      title: "Get User",
      description:
        "Get one normalized user profile by username: display name, bio, company, location, website, follower counts, account creation date, profile URL, email, avatar URL, admin flag, and platform id.",
      inputSchema: schemas.userParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.getUser(args),
    }),
    defineTool({
      name: "forges_users_authenticated",
      title: "Get Authenticated User",
      description:
        "Get the profile of the account the locally detected credentials belong to. Call this before writing anything, because every write lands under that account and the server never takes a token as an argument. The credential stays pinned until forges_auth_reload explicitly replaces it.",
      inputSchema: schemas.authenticatedUserParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.getAuthenticatedUser(args),
    }),
    defineTool({
      name: "forges_auth_reload",
      title: "Reload Authentication",
      description:
        "Replace the local credential pinned for one platform, then return the newly authenticated profile. This changes server state but writes nothing to the Git host.",
      inputSchema: schemas.authenticatedUserParameters,
      annotations: credentialStateAnnotations,
      execute: (operations, args) => operations.reloadAuthentication(args),
    }),
    defineTool({
      name: "forges_threads_list",
      title: "List Review Threads",
      description:
        "List the review threads on one pull request, optionally filtered by resolved state. Comment bodies are truncated here; read one thread whole with forges_threads_get. Gitea carries no parent id on review comments, so each comment comes back as its own single-comment thread there.",
      inputSchema: schemas.listThreadsParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.listThreads(args),
    }),
    defineTool({
      name: "forges_threads_get",
      title: "Get Review Thread",
      description:
        "Get one review thread by the exact id that forges_threads_list returned, with every comment body in full. Thread ids are platform-specific opaque strings, so never construct one.",
      inputSchema: schemas.threadParameters,
      annotations: readAnnotations,
      execute: (operations, args) => operations.getThread(args),
    }),
    defineTool({
      name: "forges_threads_reply",
      title: "Reply to Review Thread",
      description:
        "Post a reply inside an existing review thread, keeping the answer attached to the code it discusses instead of adding a standalone pull-request comment. This writes to the hosted platform under the local credentials.",
      inputSchema: schemas.replyThreadParameters,
      annotations: createAnnotations,
      execute: (operations, args) => operations.replyToThread(args),
    }),
    defineTool({
      name: "forges_threads_resolve",
      title: "Resolve Review Thread",
      description:
        "Mark one review thread resolved. This writes to the hosted platform under the local credentials, so resolve a thread only after the point it raised has actually been addressed.",
      inputSchema: schemas.threadParameters,
      annotations: threadStateAnnotations,
      execute: (operations, args) => operations.resolveThread(args),
    }),
    defineTool({
      name: "forges_threads_unresolve",
      title: "Unresolve Review Thread",
      description:
        "Reopen one resolved review thread. This writes to the hosted platform under the local credentials.",
      inputSchema: schemas.threadParameters,
      annotations: threadStateAnnotations,
      execute: (operations, args) => operations.unresolveThread(args),
    }),
  ];
}

type ValueModule = typeof import("typebox/value");
type ErrorsModule = typeof import("./errors.ts");

/**
 * Formats the first TypeBox validation failure for an MCP client. A stray key is
 * named from the schema itself, since TypeBox 1.3.24 reports it as `schema is false`.
 */
function validationError(Value: ValueModule["Value"], schema: TObject, value: object): string {
  const unknown = Object.keys(value).filter((key) => !Object.hasOwn(schema.properties, key));
  if (unknown.length > 0) return `Invalid arguments at /: unknown property ${unknown.join(", ")}`;
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

const MODEL_UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;

function escapeModelUnsafe(text: string): string {
  return text.replace(MODEL_UNSAFE, (character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return character;
    const hex = codePoint.toString(16);
    return codePoint <= 0xffff ? `\\u${hex.padStart(4, "0")}` : `\\u{${hex}}`;
  });
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text: escapeModelUnsafe(text) }], isError: true };
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
function failureText(errors: ErrorsModule, name: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const status = error instanceof errors.ForgesError ? error.status : undefined;
  const reason =
    redactEndpoint(raw) || (status === undefined ? "no reason reported" : `HTTP ${status}`);
  const retry =
    error instanceof errors.RateLimitError && error.retryAfter !== undefined
      ? ` Retry after ${error.retryAfter}s.`
      : "";
  return `${name} failed: ${reason}${retry}`;
}

/**
 * The tool table and its `tools/list` payload, built on the first `tools/list`
 * of the process. Schemas are immutable, so every server instance shares them.
 */
const tools = /* @__PURE__ */ lazy(async () => {
  const { forgesToolSchemas } = await import("../packages/shared/forges-tool-schemas.ts");
  const definitions = defineTools(forgesToolSchemas());
  return {
    byName: new Map(definitions.map((tool) => [tool.name, tool])),
    listed: definitions.map((tool): Tool => {
      const title = forgeToolTitle(tool.name, tool.title);
      return {
        name: tool.name,
        title,
        description: tool.description,
        inputSchema: { ...tool.inputSchema },
        annotations: { ...tool.annotations, title },
      };
    }),
  };
});

/** The validator, the error classes and the executors, loaded on the first `tools/call`. */
const runtime = /* @__PURE__ */ lazy(async () => {
  const [{ Value }, errors, operations] = await Promise.all([
    import("typebox/value"),
    import("./errors.ts"),
    import("./tool-operations.ts"),
  ]);
  return { Value, errors, operations };
});

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
 * Construction touches only the SDK. The schemas load with the first `tools/list`
 * and the validator, the error classes and the provider graph with the first
 * `tools/call`, so the process answers `initialize` before parsing any of them.
 *
 * Tokens and endpoints stay out of the tool surface: credentials come from the
 * local detection chain and self-hosted endpoints from the `FORGES_*_BASE_URL`
 * variables of the server process.
 */
export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "forges",
      title: "Forges",
      version,
      websiteUrl: "https://github.com/agntn/forges",
    },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await tools()).listed,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = (await tools()).byName.get(request.params.name);
    if (!tool) return errorResult(`Unknown forges tool: ${request.params.name}`);

    const { Value, errors, operations } = await runtime();
    const args = request.params.arguments ?? {};
    if (!Value.Check(tool.inputSchema, args)) {
      return errorResult(validationError(Value, tool.inputSchema, args));
    }

    try {
      return toCallToolResult(await tool.execute(operations, args));
    } catch (error) {
      return errorResult(failureText(errors, tool.name, error));
    }
  });

  return server;
}

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import type * as ForgesTools from "../../../dist/tool-operations.d.mts";

const sourceModulePath = fileURLToPath(
  new URL("../../../src/tool-operations.ts", import.meta.url),
);
let toolOperationsPromise: Promise<typeof ForgesTools> | undefined;

/**
 * Load current source in development and fall back to the built package in distributions.
 *
 * Both specifiers stay literal: OMP rewrites bare dependencies only for imports
 * it can see statically. existsSync chooses the branch; it does not build a URL
 * for a single import().
 */
function loadToolOperations(): Promise<typeof ForgesTools> {
  toolOperationsPromise ??= (
    existsSync(sourceModulePath)
      ? (import("../../../src/tool-operations.ts") as unknown as Promise<typeof ForgesTools>)
      : (import("../../../dist/tool-operations.mjs") as Promise<typeof ForgesTools>)
  );
  return toolOperationsPromise;
}

export default function forgesOmpExtension(pi: ExtensionAPI): void {
  const { Type } = pi.typebox;
  pi.setLabel("Forges");

  // OMP validates tool parameters with its host TypeBox build, so these shapes are
  // rebuilt here instead of imported from shared/forges-tool-schemas.ts, which the
  // Pi extension and the MCP server share.
  const platform = Type.Union(
    [Type.Literal("github"), Type.Literal("gitlab"), Type.Literal("gitea")],
    { description: "Git hosting platform" },
  );
  const owner = Type.String({ description: "Repository owner or organization", minLength: 1 });
  const repo = Type.String({ description: "Repository name", minLength: 1 });
  const page = Type.Optional(Type.Integer({ description: "Page number", minimum: 1 }));
  const perPage = Type.Optional(
    Type.Integer({ description: "Results per page", minimum: 1, maximum: 100 }),
  );
  const state = Type.Optional(
    Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")], {
      description: "Filter by state",
    }),
  );
  const number = Type.Integer({ description: "Issue or pull-request number", minimum: 1 });

  const listRepositoriesParameters = Type.Object({ platform, owner, page, perPage });
  const repositoryParameters = Type.Object({ platform, owner, repo });
  const listRepositoryItemsParameters = Type.Object({
    platform,
    owner,
    repo,
    page,
    perPage,
    state,
  });
  const repositoryItemParameters = Type.Object({ platform, owner, repo, number });
  const listCommentsParameters = Type.Object({ platform, owner, repo, number, page, perPage });
  const createIssueParameters = Type.Object({
    platform,
    owner,
    repo,
    title: Type.String({ description: "Issue title", minLength: 1 }),
    body: Type.String({ description: "Issue body" }),
    labels: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  });
  const createPullRequestParameters = Type.Object({
    platform,
    owner,
    repo,
    title: Type.String({ description: "Pull-request title", minLength: 1 }),
    body: Type.String({ description: "Pull-request body" }),
    sourceBranch: Type.String({ description: "Source branch", minLength: 1 }),
    targetBranch: Type.String({ description: "Target branch", minLength: 1 }),
    draft: Type.Optional(Type.Boolean({ description: "Create as a draft pull request" })),
  });
  const userParameters = Type.Object({
    platform,
    username: Type.String({ description: "Platform username", minLength: 1 }),
  });
  const authenticatedUserParameters = Type.Object({ platform });
  const threadState = Type.Optional(
    Type.Union([Type.Literal("unresolved"), Type.Literal("resolved"), Type.Literal("all")], {
      description: "Filter by resolved state",
    }),
  );
  const threadId = Type.String({ description: "Review thread id", minLength: 1 });
  const listThreadsParameters = Type.Object({
    platform,
    owner,
    repo,
    number,
    page,
    perPage,
    state: threadState,
  });
  const threadParameters = Type.Object({ platform, owner, repo, number, threadId });
  const replyThreadParameters = Type.Object({
    platform,
    owner,
    repo,
    number,
    threadId,
    body: Type.String({ description: "Reply body", minLength: 1 }),
  });

  pi.registerTool({
    name: "forges_repos_list",
    label: "Forges Repositories",
    description: "List repositories owned by a user or organization on a supported Git platform",
    parameters: listRepositoriesParameters,
    approval: "read",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listRepositories(params);
    },
  });

  pi.registerTool({
    name: "forges_repos_get",
    label: "Forges Repository",
    description: "Get one repository by owner and name from a supported Git platform",
    parameters: repositoryParameters,
    approval: "read",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getRepository(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_list",
    label: "Forges Issues",
    description: "List normalized issues for a repository, optionally filtered by state",
    parameters: listRepositoryItemsParameters,
    approval: "read",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listIssues(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_get",
    label: "Forges Issue",
    description: "Get one normalized repository issue by number",
    parameters: repositoryItemParameters,
    approval: "read",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getIssue(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_comments",
    label: "Forges Issue Comments",
    description: "List the discussion comments under one issue, oldest first",
    parameters: listCommentsParameters,
    approval: "read",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listIssueComments(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_create",
    label: "Create Forges Issue",
    description: "Create an issue in a repository; this mutates the selected Git platform",
    parameters: createIssueParameters,
    approval: "write",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).createIssue(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_list",
    label: "Forges Pull Requests",
    description: "List normalized pull requests for a repository, optionally filtered by state",
    parameters: listRepositoryItemsParameters,
    approval: "read",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequests(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_get",
    label: "Forges Pull Request",
    description: "Get one normalized pull request by repository and number",
    parameters: repositoryItemParameters,
    approval: "read",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getPullRequest(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_comments",
    label: "Forges Pull Request Comments",
    description: "List the conversation comments under one pull request, oldest first",
    parameters: listCommentsParameters,
    approval: "read",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequestComments(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_create",
    label: "Create Forges Pull Request",
    description: "Create a pull request in a repository; this mutates the selected Git platform",
    parameters: createPullRequestParameters,
    approval: "write",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).createPullRequest(params);
    },
  });

  pi.registerTool({
    name: "forges_users_get",
    label: "Forges User",
    description: "Get one normalized user profile by username from a supported Git platform",
    parameters: userParameters,
    approval: "read",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getUser(params);
    },
  });

  pi.registerTool({
    name: "forges_users_authenticated",
    label: "Forges Authenticated User",
    description: "Get the normalized user profile for the currently authenticated account",
    parameters: authenticatedUserParameters,
    approval: "read",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getAuthenticatedUser(params);
    },
  });

  pi.registerTool({
    name: "forges_threads_list",
    label: "Forges Threads",
    description:
      "List normalized pull-request review threads, optionally filtered by resolved state",
    parameters: listThreadsParameters,
    approval: "read",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listThreads(params);
    },
  });

  pi.registerTool({
    name: "forges_threads_get",
    label: "Forges Thread",
    description: "Get one normalized pull-request review thread by id",
    parameters: threadParameters,
    approval: "read",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getThread(params);
    },
  });

  pi.registerTool({
    name: "forges_threads_reply",
    label: "Reply Forges Thread",
    description:
      "Reply inside an existing pull-request review thread; this mutates the selected Git platform",
    parameters: replyThreadParameters,
    approval: "write",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).replyToThread(params);
    },
  });

  pi.registerTool({
    name: "forges_threads_resolve",
    label: "Resolve Forges Thread",
    description:
      "Mark a pull-request review thread as resolved; this mutates the selected Git platform",
    parameters: threadParameters,
    approval: "write",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).resolveThread(params);
    },
  });

  pi.registerTool({
    name: "forges_threads_unresolve",
    label: "Unresolve Forges Thread",
    description:
      "Mark a pull-request review thread as unresolved; this mutates the selected Git platform",
    parameters: threadParameters,
    approval: "write",
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).unresolveThread(params);
    },
  });
}

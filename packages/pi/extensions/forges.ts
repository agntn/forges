import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type * as ForgesTools from "../../../dist/tool-operations.d.mts";
import {
  authenticatedUserParameters,
  commentParameters,
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
} from "../../shared/forges-tool-schemas.ts";

const sourceModuleUrl = new URL("../../../src/tool-operations.ts", import.meta.url);
const distributionModuleUrl = new URL("../../../dist/tool-operations.mjs", import.meta.url);
let toolOperationsPromise: Promise<typeof ForgesTools> | undefined;

function loadToolOperations(): Promise<typeof ForgesTools> {
  toolOperationsPromise ??= import(
    existsSync(fileURLToPath(sourceModuleUrl)) ? sourceModuleUrl.href : distributionModuleUrl.href
  ) as Promise<typeof ForgesTools>;
  return toolOperationsPromise;
}

export default function forgesExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "forges_repos_list",
    label: "Forges Repositories",
    description: "List repositories owned by a user or organization on a supported Git platform",
    promptSnippet: "List repositories through GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_repos_list for repository discovery instead of constructing provider API requests.",
    ],
    parameters: listRepositoriesParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listRepositories(params);
    },
  });

  pi.registerTool({
    name: "forges_repos_get",
    label: "Forges Repository",
    description:
      "Get one repository, including fork parent and viewer access, from a supported Git platform",
    promptSnippet: "Get normalized repository metadata from GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_repos_get when exact normalized repository metadata is required.",
    ],
    parameters: repositoryParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getRepository(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_list",
    label: "Forges Issues",
    description: "List normalized issues for a repository, optionally filtered by state",
    promptSnippet: "List repository issues across GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_issues_list to inspect issue queues across supported platforms.",
    ],
    parameters: listRepositoryItemsParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listIssues(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_get",
    label: "Forges Issue",
    description: "Get one normalized repository issue by number",
    promptSnippet: "Get one repository issue from GitHub, GitLab, or Gitea.",
    promptGuidelines: ["Use forges_issues_get when the exact issue number is known."],
    parameters: repositoryItemParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getIssue(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_comments",
    label: "Forges Issue Comments",
    description: "List the discussion comments under one issue, oldest first",
    promptSnippet: "Read the discussion under an issue on GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_issues_comments to read an issue's discussion instead of scraping the web UI.",
    ],
    parameters: listCommentsParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listIssueComments(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_comments_get",
    label: "Forges Issue Comment",
    description: "Get one discussion comment under an issue, with its full body",
    promptSnippet: "Read one issue comment in full on GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_issues_comments_get with an id from forges_issues_comments when the truncated body is not enough.",
    ],
    parameters: commentParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getIssueComment(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_create",
    label: "Create Forges Issue",
    description: "Create an issue in a repository; this mutates the selected Git platform",
    promptSnippet: "Create a repository issue on GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_issues_create only when the user explicitly asks to create an issue.",
    ],
    parameters: createIssueParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).createIssue(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_list",
    label: "Forges Pull Requests",
    description: "List normalized pull requests for a repository, optionally filtered by state",
    promptSnippet: "List repository pull requests across GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_pull_requests_list to inspect pull-request queues across supported platforms.",
    ],
    parameters: listRepositoryItemsParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequests(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_get",
    label: "Forges Pull Request",
    description: "Get one normalized pull request by repository and number",
    promptSnippet: "Get one pull request from GitHub, GitLab, or Gitea.",
    promptGuidelines: ["Use forges_pull_requests_get when the exact pull-request number is known."],
    parameters: repositoryItemParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getPullRequest(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_comments",
    label: "Forges Pull Request Comments",
    description: "List the conversation comments under one pull request, oldest first",
    promptSnippet: "Read the conversation under a pull request on GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_pull_requests_comments for the pull-request conversation; review threads come from forges_threads_list.",
    ],
    parameters: listCommentsParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequestComments(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_comments_get",
    label: "Forges Pull Request Comment",
    description: "Get one conversation comment under a pull request, with its full body",
    promptSnippet:
      "Read one pull-request conversation comment in full on GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_pull_requests_comments_get with an id from forges_pull_requests_comments; review threads still come back whole from forges_threads_get.",
    ],
    parameters: commentParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getPullRequestComment(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_create",
    label: "Create Forges Pull Request",
    description: "Create a pull request in a repository; this mutates the selected Git platform",
    promptSnippet: "Create a pull request on GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_pull_requests_create only when the user explicitly asks to create a pull request.",
    ],
    parameters: createPullRequestParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).createPullRequest(params);
    },
  });

  pi.registerTool({
    name: "forges_users_get",
    label: "Forges User",
    description: "Get one normalized user profile by username from a supported Git platform",
    promptSnippet: "Get a user profile from GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_users_get to resolve a platform username to normalized metadata.",
    ],
    parameters: userParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getUser(params);
    },
  });

  pi.registerTool({
    name: "forges_users_authenticated",
    label: "Forges Authenticated User",
    description: "Get the normalized user profile for the currently authenticated account",
    promptSnippet: "Identify the authenticated GitHub, GitLab, or Gitea account.",
    promptGuidelines: [
      "Use forges_users_authenticated to identify the account selected by trusted local authentication.",
    ],
    parameters: authenticatedUserParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getAuthenticatedUser(params);
    },
  });

  pi.registerTool({
    name: "forges_auth_reload",
    label: "Reload Forges Authentication",
    description: "Replace one platform's pinned local credential and return its authenticated user",
    promptSnippet: "Reload a Git platform credential after an intentional local account switch.",
    promptGuidelines: [
      "Use forges_auth_reload only after the user intentionally changes trusted local authentication.",
    ],
    parameters: authenticatedUserParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).reloadAuthentication(params);
    },
  });

  pi.registerTool({
    name: "forges_threads_list",
    label: "Forges Threads",
    description:
      "List normalized pull-request review threads, optionally filtered by resolved state",
    promptSnippet: "List review threads on a pull request across GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_threads_list to inspect review threads instead of dumping full PR comments.",
    ],
    parameters: listThreadsParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listThreads(params);
    },
  });

  pi.registerTool({
    name: "forges_threads_get",
    label: "Forges Thread",
    description: "Get one normalized pull-request review thread by id",
    promptSnippet: "Get one review thread from GitHub, GitLab, or Gitea.",
    promptGuidelines: ["Use forges_threads_get when the exact review thread id is known."],
    parameters: threadParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getThread(params);
    },
  });

  pi.registerTool({
    name: "forges_threads_reply",
    label: "Reply Forges Thread",
    description:
      "Reply inside an existing pull-request review thread; this mutates the selected Git platform",
    promptSnippet: "Reply inside a review thread on GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_threads_reply to answer inside the thread, not as a standalone pull-request comment.",
    ],
    parameters: replyThreadParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).replyToThread(params);
    },
  });

  pi.registerTool({
    name: "forges_threads_resolve",
    label: "Resolve Forges Thread",
    description:
      "Mark a pull-request review thread as resolved; this mutates the selected Git platform",
    promptSnippet: "Resolve a review thread on GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_threads_resolve only when the user explicitly asks to resolve a thread.",
    ],
    parameters: threadParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).resolveThread(params);
    },
  });

  pi.registerTool({
    name: "forges_threads_unresolve",
    label: "Unresolve Forges Thread",
    description:
      "Mark a pull-request review thread as unresolved; this mutates the selected Git platform",
    promptSnippet: "Unresolve a review thread on GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_threads_unresolve only when the user explicitly asks to reopen a thread.",
    ],
    parameters: threadParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).unresolveThread(params);
    },
  });
}

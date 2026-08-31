import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type * as ForgesTools from "../../../dist/tool-operations.d.mts";
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

const platformLabels: Record<ForgesTools.ForgesPlatform, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
};
// oxlint-disable-next-line eslint/no-control-regex -- Removing terminal control bytes is intentional.
const controlCharacter = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;
const formatOrLineSeparator = /[\p{Cf}\p{Zl}\p{Zp}]/gu;
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function sanitizeApprovalText(value: string): string {
  const separated = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\u001B", " \u001B")
    .replaceAll("\u009B", " \u009B")
    .replaceAll("\u009D", " \u009D");
  return stripVTControlCharacters(separated)
    .replace(controlCharacter, " ")
    .replace(formatOrLineSeparator, " ")
    .replace(loneSurrogate, " ");
}

function approvalField(value: string): string {
  return sanitizeApprovalText(value).replaceAll("\n", " ");
}

function pullRequestApprovalMessage(params: ForgesTools.CreatePullRequestParams): string {
  const body = sanitizeApprovalText(params.body);
  return [
    `Repository  ${approvalField(params.owner)}/${approvalField(params.repo)} on ${platformLabels[params.platform]}`,
    `Branches    ${approvalField(params.sourceBranch)} → ${approvalField(params.targetBranch)}`,
    `Status      ${params.draft === true ? "Draft" : "Ready for review"}`,
    `Assignees   ${params.assignees?.map(approvalField).join(", ") || "None"}`,
    "",
    "Title",
    approvalField(params.title),
    "",
    "Description",
    body || "(none)",
  ].join("\n");
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
    name: "forges_contribution_templates_list",
    label: "Forges Contribution Templates",
    description:
      "List paged metadata for effective issue or pull-request templates, including inheritance provenance",
    promptSnippet: "Discover the contribution templates that apply to a repository.",
    promptGuidelines: [
      "Use forges_contribution_templates_list before drafting an issue or pull request; pass one returned kind and key to forges_contribution_templates_get when its full body is needed.",
    ],
    parameters: listContributionTemplatesParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listContributionTemplates(params);
    },
  });

  pi.registerTool({
    name: "forges_contribution_templates_get",
    label: "Forges Contribution Template",
    description: "Get one effective contribution template with its complete source body",
    promptSnippet: "Read one issue or pull-request template in full.",
    promptGuidelines: [
      "Use forges_contribution_templates_get only with the exact kind and key returned by forges_contribution_templates_list.",
    ],
    parameters: contributionTemplateParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getContributionTemplate(params);
    },
  });

  pi.registerTool({
    name: "forges_code_search",
    label: "Search Forges Code",
    description: "Search code across repositories with optional owner and repository scope",
    promptSnippet: "Search repository code on GitHub or GitLab.",
    promptGuidelines: [
      "Use forges_code_search to discover repositories from code or file fragments instead of invoking a platform CLI.",
      "forges_code_search on GitLab requires authentication; global and group scope also require Premium or Ultimate with advanced or exact code search.",
      "forges_code_search returns unsupported on Gitea, Forgejo, and GitHub-compatible hosts without a code-search endpoint.",
    ],
    parameters: codeSearchParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).searchCode(params);
    },
  });

  pi.registerTool({
    name: "forges_ci_runs_list",
    label: "Forges CI Runs",
    description: "List paged repository CI runs, optionally filtered by branch",
    promptSnippet: "Read CI runs from GitHub Actions, GitLab pipelines, or Gitea Actions.",
    promptGuidelines: [
      "Use forges_ci_runs_list to verify repository CI health instead of invoking a platform CLI.",
    ],
    parameters: listCiRunsParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listCiRuns(params);
    },
  });

  pi.registerTool({
    name: "forges_commits_list",
    label: "Forges Commits",
    description: "List paged commits, optionally filtered by ref, path, or date range",
    promptSnippet: "Read repository commit history from GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_commits_list for repository history; use forges_commits_get only when one commit's changed files are needed.",
      "forges_commits_list rejects path on Gitea because that API ignores pagination limits for the filter.",
    ],
    parameters: listCommitsParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listCommits(params);
    },
  });

  pi.registerTool({
    name: "forges_commits_get",
    label: "Forges Commit",
    description: "Get one commit with metadata and changed-file rows",
    promptSnippet: "Read one commit and the files it changed from GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_commits_get when a known commit SHA needs exact metadata or changed paths.",
    ],
    parameters: commitParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getCommit(params);
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
    name: "forges_issues_search",
    label: "Search Forges Issues",
    description: "Search repository issues with the selected platform's query syntax",
    promptSnippet: "Search issues inside one GitHub, GitLab, or Gitea repository.",
    promptGuidelines: [
      "Use forges_issues_search when duplicate checks need a query instead of the whole issue queue.",
    ],
    parameters: searchRepositoryItemsParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).searchIssues(params);
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
    name: "forges_pull_requests_search",
    label: "Search Forges Pull Requests",
    description: "Search repository pull requests with the selected platform's query syntax",
    promptSnippet: "Search pull requests inside one GitHub, GitLab, or Gitea repository.",
    promptGuidelines: [
      "Use forges_pull_requests_search for duplicate checks by query inside one repository.",
    ],
    parameters: searchRepositoryItemsParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).searchPullRequests(params);
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
    name: "forges_pull_requests_files",
    label: "Forges Pull Request Files",
    description: "List files changed by one pull request without exposing patches",
    promptSnippet: "Read changed-file paths and counts for a pull request.",
    promptGuidelines: [
      "Use forges_pull_requests_files when a review or audit needs the pull request's changed paths and line counts.",
    ],
    parameters: listPullRequestFilesParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequestFiles(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_checks",
    label: "Forges Pull Request Checks",
    description: "List normalized checks or pipelines for one pull request head revision",
    promptSnippet: "Read the current checks for a pull request on GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_pull_requests_checks to verify pull-request CI before merging or reviewing.",
    ],
    parameters: listPullRequestChecksParameters,
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequestChecks(params);
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
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        throw new Error(
          "Pull request creation requires interactive approval in Pi TUI or RPC mode",
        );
      }

      const approved = await ctx.ui.confirm(
        "Create pull request?",
        pullRequestApprovalMessage(params),
        { signal },
      );
      if (!approved) {
        throw new Error(
          "Pull request creation was cancelled by the user. Do not retry unless the user asks again.",
        );
      }

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

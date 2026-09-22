import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import type * as ForgesTools from "../../../dist/tool-operations.d.mts";
import {
  type RenderedToolResult,
  type RenderOptions,
  renderToolCall,
  renderToolResult,
  type StatusTheme,
} from "../../shared/tui.ts";
import { forgesToolSchemas } from "../../shared/forges-tool-schemas.ts";
import { lazy } from "../../shared/lazy.ts";

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

/** The approval text names the resolved target, so the dialog matches the write. */
type Resolved<P extends ForgesTools.RepositoryParams> = P & ForgesTools.RepositoryTarget;

function pullRequestApprovalMessage(params: Resolved<ForgesTools.CreatePullRequestParams>): string {
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

/** On a create an omitted flag is the platform default; on an update it stays as it is. */
function releaseApprovalMessage(
  params: Resolved<ForgesTools.CreateReleaseParams> | Resolved<ForgesTools.UpdateReleaseParams>,
  creating: boolean,
): string {
  const flag = (value: boolean | undefined, on: string, off: string) =>
    value === undefined && !creating ? "Unchanged" : value === true ? on : off;
  const text = (value: string | undefined, clean: (value: string) => string) =>
    value === undefined ? (creating ? "(none)" : "(unchanged)") : clean(value) || "(none)";
  const target =
    "ref" in params && params.ref !== undefined ? ` (from ${approvalField(params.ref)})` : "";
  return [
    `Repository  ${approvalField(params.owner)}/${approvalField(params.repo)} on ${platformLabels[params.platform]}`,
    `Tag         ${approvalField(params.tag)}${target}`,
    `Draft       ${flag(params.draft, "Yes", "No, public at once")}`,
    `Pre-release ${flag(params.prerelease, "Yes", "No")}`,
    "",
    "Title",
    text(params.name, approvalField),
    "",
    "Notes",
    text(params.body, sanitizeApprovalText),
  ].join("\n");
}

/** Release writes go public or overwrite public text, so Pi asks before either one. */
async function confirmReleaseWrite(
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  question: string,
  message: string,
  verb: string,
): Promise<void> {
  if (!ctx.hasUI) {
    throw new Error(`Release ${verb} requires interactive approval in Pi TUI or RPC mode`);
  }
  const approved = await ctx.ui.confirm(question, message, { signal });
  if (!approved) {
    throw new Error(
      `Release ${verb} was cancelled by the user. Do not retry unless the user asks again.`,
    );
  }
}

function statusRenderers(name: string, label: string) {
  return {
    renderCall(args: unknown, theme: StatusTheme, context: RenderOptions) {
      return new Text(renderToolCall(name, label, args, context, theme), 0, 0);
    },
    renderResult(
      result: RenderedToolResult,
      options: RenderOptions,
      theme: StatusTheme,
      context?: Readonly<{ isError?: boolean }>,
    ) {
      return new Text(
        renderToolResult(name, result, context?.isError === true, options, theme),
        0,
        0,
      );
    },
  };
}

export default function forgesExtension(pi: ExtensionAPI): void {
  const schemas = forgesToolSchemas();
  /** Current source in development, the built package in distributions. */
  const loadToolOperations = lazy(async () => {
    const sourceModuleUrl = new URL("../../../src/tool-operations.ts", import.meta.url);
    const distributionModuleUrl = new URL("../../../dist/tool-operations.mjs", import.meta.url);
    const moduleUrl = existsSync(fileURLToPath(sourceModuleUrl))
      ? sourceModuleUrl
      : distributionModuleUrl;
    return (await import(moduleUrl.href)) as typeof ForgesTools;
  });

  pi.registerTool({
    name: "forges_repos_list",
    label: "Forges Repositories",
    description: "List repositories owned by a user or organization on a supported Git platform",
    promptSnippet: "List repositories through GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_repos_list for repository discovery instead of constructing provider API requests.",
    ],
    parameters: schemas.listRepositoriesParameters,
    ...statusRenderers("forges_repos_list", "Forges Repositories"),
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
    parameters: schemas.repositoryParameters,
    ...statusRenderers("forges_repos_get", "Forges Repository"),
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
    parameters: schemas.listContributionTemplatesParameters,
    ...statusRenderers("forges_contribution_templates_list", "Forges Contribution Templates"),
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
    parameters: schemas.contributionTemplateParameters,
    ...statusRenderers("forges_contribution_templates_get", "Forges Contribution Template"),
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
    parameters: schemas.codeSearchParameters,
    ...statusRenderers("forges_code_search", "Search Forges Code"),
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
    parameters: schemas.listCiRunsParameters,
    ...statusRenderers("forges_ci_runs_list", "Forges CI Runs"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listCiRuns(params);
    },
  });

  pi.registerTool({
    name: "forges_commits_search",
    label: "Search Forges Commits",
    description:
      "Search commits across repositories with optional owner and repository scope. GitHub returns repository identity, author and committer dates, totalCount, incomplete, and resultLimit (1000). Results are paged; follow nextPage while hasNextPage is true. incomplete means the search is known to be partial; narrow the query when it is true. Other providers report unsupported search.",
    parameters: schemas.commitSearchParameters,
    ...statusRenderers("forges_commits_search", "Search Forges Commits"),
    promptSnippet: "Find commits without knowing their repository first.",
    promptGuidelines: [
      "Use forges_commits_search for native GitHub commit queries, including author-date: and committer-date: qualifiers; narrow the query when incomplete is true or totalCount exceeds resultLimit.",
    ],
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).searchCommits(params);
    },
  });

  pi.registerTool({
    name: "forges_commits_list",
    label: "Forges Commits",
    description: "List paged commits, optionally filtered by ref, path, or date range",
    promptSnippet: "Read repository commit history from GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_commits_list for repository history; use forges_commits_get only when one commit's changed files are needed.",
      "forges_commits_list rejects path on Gitea because that API ignores pagination limits for the filter; Forgejo paginates it.",
    ],
    parameters: schemas.listCommitsParameters,
    ...statusRenderers("forges_commits_list", "Forges Commits"),
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
    parameters: schemas.commitParameters,
    ...statusRenderers("forges_commits_get", "Forges Commit"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getCommit(params);
    },
  });

  pi.registerTool({
    name: "forges_commits_patch",
    label: "Forges Commit Patch",
    description:
      "Read one bounded commit patch slice. Continue with the returned sha, nextOffset, and same non-null path. Each slice repeats provider pagination, so use the largest practical maxChars",
    promptSnippet:
      "Read code changes from one known commit without materializing an unbounded diff.",
    promptGuidelines: [
      "Use forges_commits_patch for bounded patch slices. Continue with the returned sha, nextOffset, and same non-null path, not the original branch or tag.",
    ],
    parameters: schemas.commitPatchParameters,
    ...statusRenderers("forges_commits_patch", "Forges Commit Patch"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).readCommitPatch(params);
    },
  });

  pi.registerTool({
    name: "forges_releases_list",
    label: "Forges Releases",
    description: "List repository releases, newest first, without their notes",
    promptSnippet: "List releases from GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_releases_list to see which tags have a release; notes come from forges_releases_get.",
    ],
    parameters: schemas.listReleasesParameters,
    ...statusRenderers("forges_releases_list", "Forges Releases"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listReleases(params);
    },
  });

  pi.registerTool({
    name: "forges_releases_get",
    label: "Forges Release",
    description: "Get one release by tag with its full notes",
    promptSnippet: "Read one release by tag from GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_releases_get with the tag name; releases are keyed by tag on every platform.",
    ],
    parameters: schemas.releaseParameters,
    ...statusRenderers("forges_releases_get", "Forges Release"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getRelease(params);
    },
  });

  pi.registerTool({
    name: "forges_releases_create",
    label: "Create Forges Release",
    description: "Create a release for a tag; this mutates the selected Git platform",
    promptSnippet: "Create a release on GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_releases_create only when the user explicitly asks to publish a release; a non-draft release is public at once.",
    ],
    parameters: schemas.createReleaseParameters,
    ...statusRenderers("forges_releases_create", "Create Forges Release"),
    async execute(_toolCallId, args, signal, _onUpdate, ctx) {
      const operations = await loadToolOperations();
      const params = operations.repositoryTarget(args);
      await confirmReleaseWrite(
        ctx,
        signal,
        "Create release?",
        releaseApprovalMessage(params, true),
        "creation",
      );
      return operations.createRelease(params);
    },
  });

  pi.registerTool({
    name: "forges_releases_update",
    label: "Update Forges Release",
    description:
      "Update the title, notes or flags of the release behind a tag; this mutates the selected Git platform",
    promptSnippet: "Edit a release's title or notes on GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_releases_update only when the user explicitly asks to change a release; read it with forges_releases_get first, the new text replaces the old.",
    ],
    parameters: schemas.updateReleaseParameters,
    ...statusRenderers("forges_releases_update", "Update Forges Release"),
    async execute(_toolCallId, args, signal, _onUpdate, ctx) {
      const operations = await loadToolOperations();
      const params = operations.repositoryTarget(args);
      await confirmReleaseWrite(
        ctx,
        signal,
        "Update release?",
        releaseApprovalMessage(params, false),
        "update",
      );
      return operations.updateRelease(params);
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
    parameters: schemas.listRepositoryItemsParameters,
    ...statusRenderers("forges_issues_list", "Forges Issues"),
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
    parameters: schemas.searchRepositoryItemsParameters,
    ...statusRenderers("forges_issues_search", "Search Forges Issues"),
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
    parameters: schemas.repositoryItemParameters,
    ...statusRenderers("forges_issues_get", "Forges Issue"),
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
    parameters: schemas.listCommentsParameters,
    ...statusRenderers("forges_issues_comments", "Forges Issue Comments"),
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
    parameters: schemas.commentParameters,
    ...statusRenderers("forges_issues_comments_get", "Forges Issue Comment"),
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
    parameters: schemas.createIssueParameters,
    ...statusRenderers("forges_issues_create", "Create Forges Issue"),
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
    parameters: schemas.listRepositoryItemsParameters,
    ...statusRenderers("forges_pull_requests_list", "Forges Pull Requests"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequests(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_search_global",
    label: "Search Pull Requests Across Repositories",
    description:
      "Search pull requests across repositories. GitHub supports optional owner/repository scope and sort/order (created/desc for newest). Returns repository identity, totalCount, incomplete and resultLimit (1000). Follow nextPage while hasNextPage is true; narrow the query when incomplete is true. Other providers report unsupported search.",
    parameters: schemas.globalPullRequestSearchParameters,
    ...statusRenderers("forges_pull_requests_search_global", "Search Pull Requests"),
    promptSnippet: "Find an author's pull requests across repositories, optionally newest first.",
    promptGuidelines: [
      "Use forges_pull_requests_search_global with sort created and order desc for recent author contributions; narrow the query when incomplete is true.",
    ],
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).searchPullRequestsGlobal(params);
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
    parameters: schemas.searchRepositoryItemsParameters,
    ...statusRenderers("forges_pull_requests_search", "Search Forges Pull Requests"),
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
    parameters: schemas.repositoryItemParameters,
    ...statusRenderers("forges_pull_requests_get", "Forges Pull Request"),
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
    parameters: schemas.listPullRequestFilesParameters,
    ...statusRenderers("forges_pull_requests_files", "Forges Pull Request Files"),
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
    parameters: schemas.listPullRequestChecksParameters,
    ...statusRenderers("forges_pull_requests_checks", "Forges Pull Request Checks"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequestChecks(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_reviews",
    label: "Forges Pull Request Reviews",
    description:
      "List normalized reviews given on one pull request: who approved, who asked for changes",
    promptSnippet: "Read the reviews on a pull request on GitHub, GitLab, or Gitea.",
    promptGuidelines: [
      "Use forges_pull_requests_reviews to see who approved or requested changes before calling a pull request ready.",
    ],
    parameters: schemas.listPullRequestReviewsParameters,
    ...statusRenderers("forges_pull_requests_reviews", "Forges Pull Request Reviews"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequestReviews(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_reviews_get",
    label: "Forges Pull Request Review",
    description:
      "Get one GitHub or Gitea review with its full body and verdict. GitLab reviewer stances are unsupported.",
    promptSnippet: "Read a complete review by its id on GitHub or Gitea.",
    promptGuidelines: [
      "Use forges_pull_requests_reviews_get when the reviews list truncates a body; GitLab reviewer stances have no full review to read.",
    ],
    parameters: schemas.pullRequestReviewParameters,
    ...statusRenderers("forges_pull_requests_reviews_get", "Forges Pull Request Review"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getPullRequestReview(params);
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
    parameters: schemas.listCommentsParameters,
    ...statusRenderers("forges_pull_requests_comments", "Forges Pull Request Comments"),
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
    parameters: schemas.commentParameters,
    ...statusRenderers("forges_pull_requests_comments_get", "Forges Pull Request Comment"),
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
    parameters: schemas.createPullRequestParameters,
    ...statusRenderers("forges_pull_requests_create", "Create Forges Pull Request"),
    async execute(_toolCallId, args, signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        throw new Error(
          "Pull request creation requires interactive approval in Pi TUI or RPC mode",
        );
      }

      const operations = await loadToolOperations();
      const params = operations.repositoryTarget(args);
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

      return operations.createPullRequest(params);
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
    parameters: schemas.userParameters,
    ...statusRenderers("forges_users_get", "Forges User"),
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
    parameters: schemas.authenticatedUserParameters,
    ...statusRenderers("forges_users_authenticated", "Forges Authenticated User"),
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
    parameters: schemas.authenticatedUserParameters,
    ...statusRenderers("forges_auth_reload", "Reload Forges Authentication"),
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
    parameters: schemas.listThreadsParameters,
    ...statusRenderers("forges_threads_list", "Forges Threads"),
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
    parameters: schemas.threadParameters,
    ...statusRenderers("forges_threads_get", "Forges Thread"),
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
    parameters: schemas.replyThreadParameters,
    ...statusRenderers("forges_threads_reply", "Reply Forges Thread"),
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
    parameters: schemas.threadParameters,
    ...statusRenderers("forges_threads_resolve", "Resolve Forges Thread"),
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
    parameters: schemas.threadParameters,
    ...statusRenderers("forges_threads_unresolve", "Unresolve Forges Thread"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).unresolveThread(params);
    },
  });
  pi.registerTool({
    name: "forges_local_inspect",
    label: "Inspect Local Repository",
    description:
      "Read local Git status, a page of tracked paths and recent HEAD commit messages. Follow nextFilesOffset until null, keeping paths unchanged. No fetch or writes; concurrent index edits can change pagination.",
    parameters: schemas.localInspectParameters,
    ...statusRenderers("forges_local_inspect", "Inspect Local Repository"),
    promptSnippet: "Read local status, tracked files and path history without shell chains.",
    promptGuidelines: [
      "Use forges_local_inspect for local Git status and path history; paths are Git pathspecs, not shell commands.",
    ],
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).inspectLocal(params);
    },
  });
  pi.registerTool({
    name: "forges_local_merge_verify",
    label: "Verify Local Merge",
    description:
      "Read local Git ancestry and compare selected paths between a PR head and its merge commit. No fetch or writes. This is not permission to delete a branch.",
    parameters: schemas.localMergeParameters,
    ...statusRenderers("forges_local_merge_verify", "Verify Local Merge"),
    promptSnippet: "Verify merge ancestry and selected file contents in a local checkout.",
    promptGuidelines: [
      "Use forges_local_merge_verify after fetching the target ref; matching paths alone never authorizes branch deletion.",
    ],
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).verifyLocalMerge(params);
    },
  });
}

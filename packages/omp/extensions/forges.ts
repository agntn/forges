import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import type * as ForgesTools from "../../../dist/tool-operations.d.mts";
import {
  type RenderedToolResult,
  type RenderOptions,
  renderToolCall,
  renderToolResult,
  type StatusTheme,
} from "../../shared/tui.ts";
import { lazy } from "../../shared/lazy.ts";
import { toolApproval } from "../../shared/tool-effects.ts";

export default function forgesOmpExtension(pi: ExtensionAPI): void {
  const { Type } = pi.typebox;
  const { Text } = pi.pi;
  /**
   * Current source in development, the built package in distributions.
   *
   * Both specifiers stay literal: OMP rewrites bare dependencies only for imports
   * it can see statically. existsSync chooses the branch; it does not build a URL
   * for a single import().
   */
  const loadToolOperations = lazy(async () => {
    const sourceModulePath = fileURLToPath(
      new URL("../../../src/tool-operations.ts", import.meta.url),
    );
    return existsSync(sourceModulePath)
      ? ((await import("../../../src/tool-operations.ts")) as unknown as typeof ForgesTools)
      : ((await import("../../../dist/tool-operations.mjs")) as typeof ForgesTools);
  });
  function statusRenderers(name: string, label: string) {
    return {
      renderCall(args: unknown, options: RenderOptions, theme: StatusTheme) {
        return new Text(renderToolCall(name, label, args, options, theme), 0, 0);
      },
      renderResult(result: RenderedToolResult, options: RenderOptions, theme: StatusTheme) {
        return new Text(
          renderToolResult(name, result, result.isError === true, options, theme),
          0,
          0,
        );
      },
    };
  }
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
  const contributionTemplateKind = Type.Union(
    [Type.Literal("issue"), Type.Literal("pull_request")],
    { description: "Contribution template kind" },
  );
  const contributionTemplateKey = Type.String({
    description: "Provider key returned by the contribution-template list operation",
    minLength: 1,
  });
  const sha = Type.String({ description: "Commit SHA", minLength: 1 });
  const tag = Type.String({ description: "Release tag name", minLength: 1 });
  const releaseName = Type.Optional(Type.String({ description: "Release title" }));
  const releaseBody = Type.Optional(Type.String({ description: "Release notes" }));
  const draft = Type.Optional(
    Type.Boolean({ description: "Keep the release an unpublished draft. GitLab rejects true." }),
  );
  const prerelease = Type.Optional(
    Type.Boolean({ description: "Mark the release a pre-release. GitLab rejects true." }),
  );
  const branch = Type.Optional(Type.String({ description: "Filter by branch", minLength: 1 }));
  const ref = Type.Optional(
    Type.String({ description: "Branch, tag, or commit reference", minLength: 1 }),
  );
  const path = Type.Optional(
    Type.String({ description: "Filter by repository path", minLength: 1 }),
  );
  const since = Type.Optional(
    Type.String({ description: "Only commits at or after this ISO-8601 date", minLength: 1 }),
  );
  const until = Type.Optional(
    Type.String({ description: "Only commits at or before this ISO-8601 date", minLength: 1 }),
  );
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
  const assignees = Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description: "Assignee logins. GitLab Free accepts only one.",
      maxItems: 10,
    }),
  );

  /** Closed like the shared schemas: an unknown argument fails instead of vanishing. */
  function closed<P extends Parameters<typeof Type.Object>[0]>(properties: P) {
    return Type.Object(properties, { additionalProperties: false });
  }

  const listRepositoriesParameters = closed({ platform, owner, page, perPage });
  const repositoryParameters = closed({ platform, owner, repo });
  const listContributionTemplatesParameters = closed({
    platform,
    owner,
    repo,
    kind: contributionTemplateKind,
    page,
    perPage,
  });
  const contributionTemplateParameters = closed({
    platform,
    owner,
    repo,
    kind: contributionTemplateKind,
    key: contributionTemplateKey,
  });
  const codeSearchParameters = closed({
    platform,
    query: Type.String({
      description: "Search query in the selected provider's syntax",
      minLength: 1,
    }),
    owner: Type.Optional(owner),
    repo: Type.Optional(repo),
    page,
    perPage,
  });
  const commitSearchParameters = closed({
    platform,
    query: Type.String({
      description: "Native commit query, including author-date: or committer-date: qualifiers",
      minLength: 1,
    }),
    owner: Type.Optional(owner),
    repo: Type.Optional(repo),
    page,
    perPage,
  });
  const commitParameters = closed({ platform, owner, repo, sha });
  const commitPatchParameters = closed({
    platform,
    owner,
    repo,
    sha,
    path: Type.Optional(
      Type.String({ description: "Only return the patch stream for this file path", minLength: 1 }),
    ),
    offset: Type.Optional(
      Type.Integer({
        description: "UTF-16 code-unit offset returned by the previous patch slice; defaults to 0",
        minimum: 0,
      }),
    ),
    maxChars: Type.Optional(
      Type.Integer({
        description: "Maximum patch UTF-16 code units to return; defaults to 20000",
        minimum: 1,
        maximum: 200000,
      }),
    ),
  });
  const listCommitsParameters = closed({
    platform,
    owner,
    repo,
    ref,
    path,
    since,
    until,
    page,
    perPage,
  });
  const listCiRunsParameters = closed({ platform, owner, repo, branch, page, perPage });
  const listReleasesParameters = closed({ platform, owner, repo, page, perPage });
  const releaseParameters = closed({ platform, owner, repo, tag });
  const createReleaseParameters = closed({
    platform,
    owner,
    repo,
    tag,
    name: releaseName,
    body: releaseBody,
    ref: Type.Optional(
      Type.String({
        description: "Branch or commit to tag when the tag does not exist yet",
        minLength: 1,
      }),
    ),
    draft,
    prerelease,
  });
  const updateReleaseParameters = closed({
    platform,
    owner,
    repo,
    tag,
    name: releaseName,
    body: releaseBody,
    draft,
    prerelease,
  });
  const listRepositoryItemsParameters = closed({
    platform,
    owner,
    repo,
    page,
    perPage,
    state,
  });
  const searchRepositoryItemsParameters = closed({
    platform,
    owner,
    repo,
    query: Type.String({
      description: "Search query in the selected provider's syntax",
      minLength: 1,
    }),
    page,
    perPage,
    state,
  });
  const repositoryItemParameters = closed({ platform, owner, repo, number });
  const listCommentsParameters = closed({ platform, owner, repo, number, page, perPage });
  const listPullRequestFilesParameters = listCommentsParameters;
  const listPullRequestChecksParameters = listCommentsParameters;
  const listPullRequestReviewsParameters = listCommentsParameters;
  const pullRequestReviewParameters = closed({
    platform,
    owner,
    repo,
    number,
    reviewId: Type.String({ description: "Review id returned by the reviews list", minLength: 1 }),
  });
  const commentId = Type.String({ description: "Discussion comment id", minLength: 1 });
  const commentParameters = closed({ platform, owner, repo, number, commentId });
  const createIssueParameters = closed({
    platform,
    owner,
    repo,
    title: Type.String({ description: "Issue title", minLength: 1 }),
    body: Type.String({ description: "Issue body" }),
    labels: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    assignees,
  });
  const createPullRequestParameters = closed({
    platform,
    owner,
    repo,
    title: Type.String({ description: "Pull-request title", minLength: 1 }),
    body: Type.String({ description: "Pull-request body" }),
    sourceBranch: Type.String({ description: "Source branch", minLength: 1 }),
    targetBranch: Type.String({ description: "Target branch", minLength: 1 }),
    draft: Type.Optional(Type.Boolean({ description: "Create as a draft pull request" })),
    assignees,
  });
  const userParameters = closed({
    platform,
    username: Type.String({ description: "Platform username", minLength: 1 }),
  });
  const authenticatedUserParameters = closed({ platform });
  const threadState = Type.Optional(
    Type.Union([Type.Literal("unresolved"), Type.Literal("resolved"), Type.Literal("all")], {
      description: "Filter by resolved state",
    }),
  );
  const threadId = Type.String({ description: "Review thread id", minLength: 1 });
  const listThreadsParameters = closed({
    platform,
    owner,
    repo,
    number,
    page,
    perPage,
    state: threadState,
  });
  const threadParameters = closed({ platform, owner, repo, number, threadId });
  const replyThreadParameters = closed({
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
    ...statusRenderers("forges_repos_list", "Forges Repositories"),
    approval: toolApproval("forges_repos_list"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listRepositories(params);
    },
  });

  pi.registerTool({
    name: "forges_repos_get",
    label: "Forges Repository",
    description:
      "Get one repository, including fork parent and viewer access, from a supported Git platform",
    parameters: repositoryParameters,
    ...statusRenderers("forges_repos_get", "Forges Repository"),
    approval: toolApproval("forges_repos_get"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getRepository(params);
    },
  });

  pi.registerTool({
    name: "forges_contribution_templates_list",
    label: "Forges Contribution Templates",
    description:
      "List paged metadata for effective issue or pull-request templates, including inheritance provenance",
    parameters: listContributionTemplatesParameters,
    ...statusRenderers("forges_contribution_templates_list", "Forges Contribution Templates"),
    approval: toolApproval("forges_contribution_templates_list"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listContributionTemplates(params);
    },
  });

  pi.registerTool({
    name: "forges_contribution_templates_get",
    label: "Forges Contribution Template",
    description: "Get one effective contribution template with its complete source body",
    parameters: contributionTemplateParameters,
    ...statusRenderers("forges_contribution_templates_get", "Forges Contribution Template"),
    approval: toolApproval("forges_contribution_templates_get"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getContributionTemplate(params);
    },
  });

  pi.registerTool({
    name: "forges_code_search",
    label: "Search Forges Code",
    description:
      "Search code across repositories with optional owner and repository scope; GitLab requires authentication, and global or group scope requires Premium or Ultimate with advanced or exact code search; Gitea, Forgejo, and GitHub-compatible hosts without the endpoint are unsupported",
    parameters: codeSearchParameters,
    ...statusRenderers("forges_code_search", "Search Forges Code"),
    approval: toolApproval("forges_code_search"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).searchCode(params);
    },
  });

  pi.registerTool({
    name: "forges_ci_runs_list",
    label: "Forges CI Runs",
    description: "List paged repository CI runs, optionally filtered by branch",
    parameters: listCiRunsParameters,
    ...statusRenderers("forges_ci_runs_list", "Forges CI Runs"),
    approval: toolApproval("forges_ci_runs_list"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listCiRuns(params);
    },
  });

  pi.registerTool({
    name: "forges_commits_search",
    label: "Search Forges Commits",
    description:
      "Search commits across repositories with optional owner and repository scope. GitHub returns repository identity, author and committer dates, totalCount, incomplete, and resultLimit (1000). Results are paged; follow nextPage while hasNextPage is true. incomplete means the search is known to be partial; narrow the query when it is true. Other providers report unsupported search.",
    parameters: commitSearchParameters,
    ...statusRenderers("forges_commits_search", "Search Forges Commits"),
    approval: toolApproval("forges_commits_search"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).searchCommits(params);
    },
  });

  pi.registerTool({
    name: "forges_commits_list",
    label: "Forges Commits",
    description:
      "List paged commits, optionally filtered by ref, path, or date range; Gitea rejects path because its API ignores pagination limits; Forgejo paginates it",
    parameters: listCommitsParameters,
    ...statusRenderers("forges_commits_list", "Forges Commits"),
    approval: toolApproval("forges_commits_list"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listCommits(params);
    },
  });

  pi.registerTool({
    name: "forges_commits_get",
    label: "Forges Commit",
    description: "Get one commit with metadata and changed-file rows",
    parameters: commitParameters,
    ...statusRenderers("forges_commits_get", "Forges Commit"),
    approval: toolApproval("forges_commits_get"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getCommit(params);
    },
  });

  pi.registerTool({
    name: "forges_commits_patch",
    label: "Forges Commit Patch",
    description:
      "Read one bounded commit patch slice. Continue with the returned sha and nextOffset; binary, unavailable, and truncated states stay distinct",
    parameters: commitPatchParameters,
    ...statusRenderers("forges_commits_patch", "Forges Commit Patch"),
    approval: toolApproval("forges_commits_patch"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).readCommitPatch(params);
    },
  });

  pi.registerTool({
    name: "forges_releases_list",
    label: "Forges Releases",
    description: "List repository releases, newest first, without their notes",
    parameters: listReleasesParameters,
    ...statusRenderers("forges_releases_list", "Forges Releases"),
    approval: toolApproval("forges_releases_list"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listReleases(params);
    },
  });

  pi.registerTool({
    name: "forges_releases_get",
    label: "Forges Release",
    description: "Get one release by tag with its full notes",
    parameters: releaseParameters,
    ...statusRenderers("forges_releases_get", "Forges Release"),
    approval: toolApproval("forges_releases_get"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getRelease(params);
    },
  });

  pi.registerTool({
    name: "forges_releases_create",
    label: "Create Forges Release",
    description: "Create a release for a tag; this mutates the selected Git platform",
    parameters: createReleaseParameters,
    ...statusRenderers("forges_releases_create", "Create Forges Release"),
    approval: toolApproval("forges_releases_create"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).createRelease(params);
    },
  });

  pi.registerTool({
    name: "forges_releases_update",
    label: "Update Forges Release",
    description:
      "Update the title, notes or flags of the release behind a tag; this mutates the selected Git platform",
    parameters: updateReleaseParameters,
    ...statusRenderers("forges_releases_update", "Update Forges Release"),
    approval: toolApproval("forges_releases_update"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).updateRelease(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_list",
    label: "Forges Issues",
    description: "List normalized issues for a repository, optionally filtered by state",
    parameters: listRepositoryItemsParameters,
    ...statusRenderers("forges_issues_list", "Forges Issues"),
    approval: toolApproval("forges_issues_list"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listIssues(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_search",
    label: "Search Forges Issues",
    description: "Search repository issues with the selected platform's query syntax",
    parameters: searchRepositoryItemsParameters,
    ...statusRenderers("forges_issues_search", "Search Forges Issues"),
    approval: toolApproval("forges_issues_search"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).searchIssues(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_get",
    label: "Forges Issue",
    description: "Get one normalized repository issue by number",
    parameters: repositoryItemParameters,
    ...statusRenderers("forges_issues_get", "Forges Issue"),
    approval: toolApproval("forges_issues_get"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getIssue(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_comments",
    label: "Forges Issue Comments",
    description: "List the discussion comments under one issue, oldest first",
    parameters: listCommentsParameters,
    ...statusRenderers("forges_issues_comments", "Forges Issue Comments"),
    approval: toolApproval("forges_issues_comments"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listIssueComments(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_comments_get",
    label: "Forges Issue Comment",
    description: "Get one discussion comment under an issue, with its full body",
    parameters: commentParameters,
    ...statusRenderers("forges_issues_comments_get", "Forges Issue Comment"),
    approval: toolApproval("forges_issues_comments_get"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getIssueComment(params);
    },
  });

  pi.registerTool({
    name: "forges_issues_create",
    label: "Create Forges Issue",
    description: "Create an issue in a repository; this mutates the selected Git platform",
    parameters: createIssueParameters,
    ...statusRenderers("forges_issues_create", "Create Forges Issue"),
    approval: toolApproval("forges_issues_create"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).createIssue(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_list",
    label: "Forges Pull Requests",
    description: "List normalized pull requests for a repository, optionally filtered by state",
    parameters: listRepositoryItemsParameters,
    ...statusRenderers("forges_pull_requests_list", "Forges Pull Requests"),
    approval: toolApproval("forges_pull_requests_list"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequests(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_search",
    label: "Search Forges Pull Requests",
    description: "Search repository pull requests with the selected platform's query syntax",
    parameters: searchRepositoryItemsParameters,
    ...statusRenderers("forges_pull_requests_search", "Search Forges Pull Requests"),
    approval: toolApproval("forges_pull_requests_search"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).searchPullRequests(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_get",
    label: "Forges Pull Request",
    description: "Get one normalized pull request by repository and number",
    parameters: repositoryItemParameters,
    ...statusRenderers("forges_pull_requests_get", "Forges Pull Request"),
    approval: toolApproval("forges_pull_requests_get"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getPullRequest(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_files",
    label: "Forges Pull Request Files",
    description: "List files changed by one pull request without exposing patches",
    parameters: listPullRequestFilesParameters,
    ...statusRenderers("forges_pull_requests_files", "Forges Pull Request Files"),
    approval: toolApproval("forges_pull_requests_files"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequestFiles(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_checks",
    label: "Forges Pull Request Checks",
    description: "List normalized checks or pipelines for one pull request head revision",
    parameters: listPullRequestChecksParameters,
    ...statusRenderers("forges_pull_requests_checks", "Forges Pull Request Checks"),
    approval: toolApproval("forges_pull_requests_checks"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequestChecks(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_reviews",
    label: "Forges Pull Request Reviews",
    description:
      "List normalized reviews given on one pull request: who approved, who asked for changes",
    parameters: listPullRequestReviewsParameters,
    ...statusRenderers("forges_pull_requests_reviews", "Forges Pull Request Reviews"),
    approval: toolApproval("forges_pull_requests_reviews"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequestReviews(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_reviews_get",
    label: "Forges Pull Request Review",
    description:
      "Get one GitHub or Gitea review with its full body and verdict. GitLab reviewer stances are unsupported.",
    parameters: pullRequestReviewParameters,
    ...statusRenderers("forges_pull_requests_reviews_get", "Forges Pull Request Review"),
    approval: toolApproval("forges_pull_requests_reviews_get"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getPullRequestReview(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_comments",
    label: "Forges Pull Request Comments",
    description: "List the conversation comments under one pull request, oldest first",
    parameters: listCommentsParameters,
    ...statusRenderers("forges_pull_requests_comments", "Forges Pull Request Comments"),
    approval: toolApproval("forges_pull_requests_comments"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listPullRequestComments(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_comments_get",
    label: "Forges Pull Request Comment",
    description: "Get one conversation comment under a pull request, with its full body",
    parameters: commentParameters,
    ...statusRenderers("forges_pull_requests_comments_get", "Forges Pull Request Comment"),
    approval: toolApproval("forges_pull_requests_comments_get"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getPullRequestComment(params);
    },
  });

  pi.registerTool({
    name: "forges_pull_requests_create",
    label: "Create Forges Pull Request",
    description: "Create a pull request in a repository; this mutates the selected Git platform",
    parameters: createPullRequestParameters,
    ...statusRenderers("forges_pull_requests_create", "Create Forges Pull Request"),
    approval: toolApproval("forges_pull_requests_create"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).createPullRequest(params);
    },
  });

  pi.registerTool({
    name: "forges_users_get",
    label: "Forges User",
    description: "Get one normalized user profile by username from a supported Git platform",
    parameters: userParameters,
    ...statusRenderers("forges_users_get", "Forges User"),
    approval: toolApproval("forges_users_get"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getUser(params);
    },
  });

  pi.registerTool({
    name: "forges_users_authenticated",
    label: "Forges Authenticated User",
    description: "Get the normalized user profile for the currently authenticated account",
    parameters: authenticatedUserParameters,
    ...statusRenderers("forges_users_authenticated", "Forges Authenticated User"),
    approval: toolApproval("forges_users_authenticated"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).getAuthenticatedUser(params);
    },
  });

  pi.registerTool({
    name: "forges_auth_reload",
    label: "Reload Forges Authentication",
    description: "Replace one platform's pinned local credential and return its authenticated user",
    parameters: authenticatedUserParameters,
    ...statusRenderers("forges_auth_reload", "Reload Forges Authentication"),
    approval: toolApproval("forges_auth_reload"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).reloadAuthentication(params);
    },
  });

  pi.registerTool({
    name: "forges_threads_list",
    label: "Forges Threads",
    description:
      "List normalized pull-request review threads, optionally filtered by resolved state",
    parameters: listThreadsParameters,
    ...statusRenderers("forges_threads_list", "Forges Threads"),
    approval: toolApproval("forges_threads_list"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).listThreads(params);
    },
  });

  pi.registerTool({
    name: "forges_threads_get",
    label: "Forges Thread",
    description: "Get one normalized pull-request review thread by id",
    parameters: threadParameters,
    ...statusRenderers("forges_threads_get", "Forges Thread"),
    approval: toolApproval("forges_threads_get"),
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
    ...statusRenderers("forges_threads_reply", "Reply Forges Thread"),
    approval: toolApproval("forges_threads_reply"),
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
    ...statusRenderers("forges_threads_resolve", "Resolve Forges Thread"),
    approval: toolApproval("forges_threads_resolve"),
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
    ...statusRenderers("forges_threads_unresolve", "Unresolve Forges Thread"),
    approval: toolApproval("forges_threads_unresolve"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).unresolveThread(params);
    },
  });
  const localMergeParameters = closed({
    cwd: Type.String({ description: "Local checkout directory", minLength: 1 }),
    head: Type.String({ description: "PR head commit or ref", minLength: 1 }),
    mergeCommit: Type.String({
      description: "Merge or squash commit reported by the forge",
      minLength: 1,
    }),
    target: Type.String({ description: "Local target ref, fetched by the caller", minLength: 1 }),
    paths: Type.Array(Type.String({ minLength: 1 }), {
      description: "Literal paths relative to the repository root",
      minItems: 1,
      maxItems: 100,
    }),
  });
  const localInspectParameters = Type.Object(
    {
      cwd: Type.String({ description: "Local checkout directory", minLength: 1 }),
      paths: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), {
          description:
            "Git pathspecs relative to the repository root; omitted means all paths. Wildcards and :(literal) are supported.",
          maxItems: 100,
        }),
      ),
      historyLimit: Type.Optional(
        Type.Integer({
          description: "Maximum HEAD commits to return, including message bodies; defaults to 3",
          minimum: 1,
          maximum: 100,
        }),
      ),
    },
    { additionalProperties: false },
  );

  pi.registerTool({
    name: "forges_local_inspect",
    label: "Inspect Local Repository",
    description:
      "Read local Git status, tracked paths and recent HEAD commit messages in one call. Supports Git pathspecs. No fetch or writes; the reads are not an atomic snapshot.",
    parameters: localInspectParameters,
    ...statusRenderers("forges_local_inspect", "Inspect Local Repository"),
    approval: toolApproval("forges_local_inspect"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).inspectLocal(params);
    },
  });
  pi.registerTool({
    name: "forges_local_merge_verify",
    label: "Verify Local Merge",
    description:
      "Read local Git ancestry and compare selected paths between a PR head and its merge commit. No fetch or writes. This is not permission to delete a branch.",
    parameters: localMergeParameters,
    ...statusRenderers("forges_local_merge_verify", "Verify Local Merge"),
    approval: toolApproval("forges_local_merge_verify"),
    async execute(_toolCallId, params) {
      return (await loadToolOperations()).verifyLocalMerge(params);
    },
  });
}

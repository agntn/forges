import { defineTool, type ToolDefinition } from "@agntn/tools";

import { lazy } from "../packages/shared/lazy.ts";
import {
  toolEffects,
  type ForgesToolName,
  type ToolEffect,
} from "../packages/shared/tool-effects.ts";
import { forgeToolTitle } from "../packages/shared/tui.ts";
import { EMPTY_CHECK_GRACE_SECONDS } from "./check-wait.ts";
import { forgesToolSchemas } from "./tool-schemas.ts";

type Operations = typeof import("./tool-operations.ts");

/** The executors and the provider graph, loaded on the first call rather than at import. */
const loadOperations = /* @__PURE__ */ lazy(() => import("./tool-operations.ts"));

/** How each forges effect reads to a host: MCP hints, the OMP approval tier, the CLI. */
const hostEffects = {
  hostedRead: { effect: "read", openWorld: true },
  localRead: { effect: "read" },
  remoteCreate: { effect: "write", idempotent: false, openWorld: true },
  remoteUpdate: { effect: "destructive", idempotent: true, openWorld: true },
  remoteState: { effect: "write", idempotent: true, openWorld: true },
  credentialReload: { effect: "write", idempotent: false, openWorld: true },
} as const satisfies Record<
  ToolEffect,
  Pick<ToolDefinition, "effect" | "idempotent" | "openWorld">
>;

function effect(name: ForgesToolName): (typeof hostEffects)[ToolEffect] {
  return hostEffects[toolEffects[name]];
}

/** Runs one executor; a failure from outside a provider loses its endpoint on the way out. */
async function call<T>(run: (operations: Operations) => Promise<T>): Promise<T> {
  const operations = await loadOperations();
  try {
    return await run(operations);
  } catch (error) {
    throw operations.toolFailure(error);
  }
}

let tools: readonly ToolDefinition[] | undefined;

/** The 52 tools for every surface, built on the first call so an import parses nothing. */
export function forgesTools(): readonly ToolDefinition[] {
  tools ??= defineTools();
  return tools;
}

function defineTools(): ToolDefinition[] {
  const schemas = forgesToolSchemas();
  return [
    defineTool({
      name: "forges_repos_list",
      title: forgeToolTitle("forges_repos_list", "List Repositories"),
      description:
        "List the repositories owned by one user or organization on GitHub, GitLab, Gitea, or Forgejo, or in a Cloudflare Artifacts namespace, normalized to one shape. A row leaves out an owner that repeats the one asked for, and the merge settings, which come with forges_repos_get. Results are paged: read hasNextPage and nextPage instead of assuming the first page is everything.",
      snippet: "List repositories through GitHub, GitLab, Gitea, or Cloudflare Artifacts.",
      guidelines: [
        "Use forges_repos_list for repository discovery instead of constructing provider API requests.",
      ],
      ...effect("forges_repos_list"),
      input: schemas.listRepositoriesParameters,
      execute: (args) => call((operations) => operations.listRepositories(args)),
    }),
    defineTool({
      name: "forges_repos_get",
      title: forgeToolTitle("forges_repos_get", "Get Repository"),
      description:
        "Get one repository by owner and name, normalized across platforms: description, visibility, default branch, fork parent, viewer permission, merge settings, web and clone URL, and owner. A null viewerPermission means the platform omitted access metadata. A null merge means the platform kept its settings back, as GitHub does without push access and GitLab without a token, or has no pull requests to merge, as Cloudflare Artifacts. It never means no method works.",
      snippet:
        "Get normalized repository metadata from GitHub, GitLab, Gitea, or Cloudflare Artifacts.",
      guidelines: [
        "Use forges_repos_get when exact normalized repository metadata is required.",
        "Read merge from forges_repos_get before a pull request instead of gh api repos/<owner>/<repo>: with squash and squashTitle COMMIT_OR_PR_TITLE, a lone commit's subject becomes the merged title.",
      ],
      ...effect("forges_repos_get"),
      input: schemas.repositoryParameters,
      execute: (args) => call((operations) => operations.getRepository(args)),
    }),
    defineTool({
      name: "forges_repos_contents",
      title: forgeToolTitle("forges_repos_contents", "Read Repository Contents"),
      description:
        "Read one file or directory of a repository at a branch, tag or commit; ref defaults to the default branch. A file returns one bounded text slice with the resolved commit sha, its byte size and nextOffset; continue with that sha as ref and nextOffset. Binary files come back labeled with empty content, files above 1 MiB are refused, and a directory returns its entries.",
      snippet: "Read a file or list a directory of a remote repository without cloning it.",
      guidelines: [
        "Use forges_repos_contents instead of gh api contents or raw.githubusercontent.com. Continue a long file with the returned sha as ref and nextOffset.",
      ],
      ...effect("forges_repos_contents"),
      input: schemas.repositoryContentsParameters,
      execute: (args) => call((operations) => operations.readRepositoryContents(args)),
    }),
    defineTool({
      name: "forges_repos_tags",
      title: forgeToolTitle("forges_repos_tags", "List Repository Tags"),
      description:
        "List the Git tags of one repository, each with the commit it points at. An annotated tag is peeled to its commit, not its tag object, and sha is null when the forge names no commit. GitLab is asked for version order, newest first. GitHub and Gitea promise no order, so compare names instead of trusting the first row. A tag needs no release, so this also finds the ones forges_releases_list never shows. Results are paged: read hasNextPage and nextPage instead of assuming the first page is everything.",
      snippet: "List repository tags from GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_repos_tags instead of gh api tags or git ls-remote --tags. Pick the newest tag by comparing names, not by row position.",
      ],
      ...effect("forges_repos_tags"),
      input: schemas.listTagsParameters,
      execute: (args) => call((operations) => operations.listTags(args)),
    }),
    defineTool({
      name: "forges_contribution_templates_list",
      title: forgeToolTitle("forges_contribution_templates_list", "List Contribution Templates"),
      description:
        "List paged metadata for the effective issue or pull-request templates of one repository. Results identify local versus inherited files and their source when the platform exposes it. Bodies are omitted; pass the returned kind and key unchanged to forges_contribution_templates_get.",
      snippet: "Discover the contribution templates that apply to a repository.",
      guidelines: [
        "Use forges_contribution_templates_list before drafting an issue or pull request; pass one returned kind and key to forges_contribution_templates_get when its full body is needed.",
      ],
      ...effect("forges_contribution_templates_list"),
      input: schemas.listContributionTemplatesParameters,
      execute: (args) => call((operations) => operations.listContributionTemplates(args)),
    }),
    defineTool({
      name: "forges_contribution_templates_get",
      title: forgeToolTitle("forges_contribution_templates_get", "Get Contribution Template"),
      description:
        "Get the full source body of one effective issue or pull-request template. Use the exact kind and provider key returned by forges_contribution_templates_list.",
      snippet: "Read one issue or pull-request template in full.",
      guidelines: [
        "Use forges_contribution_templates_get only with the exact kind and key returned by forges_contribution_templates_list.",
      ],
      ...effect("forges_contribution_templates_get"),
      input: schemas.contributionTemplateParameters,
      execute: (args) => call((operations) => operations.getContributionTemplate(args)),
    }),
    defineTool({
      name: "forges_code_search",
      title: forgeToolTitle("forges_code_search", "Search Repository Code"),
      description:
        "Search code across repositories, optionally scoped to an owner or one repository. Results contain normalized repository names, paths, and web URLs. Results are paged, and incomplete says whether the search is known to be partial. GitLab requires authentication, and its global or group code search requires Premium or Ultimate with advanced or exact code search. Gitea, Forgejo, and GitHub-compatible hosts without the endpoint return an explicit unsupported error.",
      snippet: "Search repository code on GitHub or GitLab.",
      guidelines: [
        "Use forges_code_search to discover repositories from code or file fragments instead of invoking a platform CLI.",
        "forges_code_search on GitLab requires authentication; global and group scope also require Premium or Ultimate with advanced or exact code search.",
        "forges_code_search returns unsupported on Gitea, Forgejo, and GitHub-compatible hosts without a code-search endpoint.",
      ],
      ...effect("forges_code_search"),
      input: schemas.codeSearchParameters,
      execute: (args) => call((operations) => operations.searchCode(args)),
    }),
    defineTool({
      name: "forges_ci_runs_list",
      title: forgeToolTitle("forges_ci_runs_list", "List CI Runs"),
      description:
        "List paged repository CI runs, normalized from GitHub Actions, GitLab pipelines, and Gitea Actions. Each run includes its branch, revision SHA, lifecycle status, terminal conclusion, and web URL. Filter by branch when checking whether a specific line of development is green.",
      snippet: "Read CI runs from GitHub Actions, GitLab pipelines, or Gitea Actions.",
      guidelines: [
        "Use forges_ci_runs_list to verify repository CI health instead of invoking a platform CLI.",
      ],
      ...effect("forges_ci_runs_list"),
      input: schemas.listCiRunsParameters,
      execute: (args) => call((operations) => operations.listCiRuns(args)),
    }),
    defineTool({
      name: "forges_ci_jobs_list",
      title: forgeToolTitle("forges_ci_jobs_list", "List CI Jobs"),
      description:
        "List the jobs of one CI run with their lifecycle status, terminal conclusion, start and end times, web URL and, on GitHub and Gitea, their steps. A failed job has conclusion failure; read its log with forges_ci_jobs_log. An empty page 1 means the run started no jobs. GitLab jobs report no steps.",
      snippet: "List the jobs and steps of one CI run to find the one that failed.",
      guidelines: [
        "Use forges_ci_jobs_list instead of gh run view --json jobs to find which job and step of a run failed.",
      ],
      ...effect("forges_ci_jobs_list"),
      input: schemas.listCiJobsParameters,
      execute: (args) => call((operations) => operations.listCiJobs(args)),
    }),
    defineTool({
      name: "forges_ci_jobs_log",
      title: forgeToolTitle("forges_ci_jobs_log", "Read CI Job Log"),
      description:
        "Read one CI job log as a bounded text slice without timestamps or ANSI escapes. On GitHub and Gitea each step is a --- step N name: conclusion section and failing steps come first, so the first slice explains the failure; GitLab traces read in order, so start near length - maxChars for the end. Continue with nextOffset. started is false when no runner took the job, and logComplete is false when only the end of a very long log was kept.",
      snippet: "Read why a CI job failed from its log, failing step first.",
      guidelines: [
        "Use forges_ci_jobs_log instead of gh run view --log-failed. On GitHub a failing check id from forges_pull_requests_checks is the job id.",
      ],
      ...effect("forges_ci_jobs_log"),
      input: schemas.ciJobLogParameters,
      execute: (args) => call((operations) => operations.readCiJobLog(args)),
    }),
    defineTool({
      name: "forges_commits_search",
      title: forgeToolTitle("forges_commits_search", "Search Commits"),
      description:
        "Search commits across repositories with optional owner and repository scope. Rows carry repository identity and author and committer dates; a committer identical to the author is left out. GitHub takes its native qualifiers and returns totalCount and resultLimit (1000). GitLab matches message keywords or a SHA on the default branch, returns no totalCount and resultLimit null, and searches a group or the whole instance only with advanced search, so pass owner and repo on other hosts. Messages are cut to their subject line and messageTruncated marks the cut ones; read one whole with forges_commits_get. Results are paged; follow nextPage while hasNextPage is true. incomplete means the search is known to be partial; narrow the query when it is true. Gitea reports unsupported search.",
      snippet: "Find commits without knowing their repository first.",
      guidelines: [
        "Use forges_commits_search for native GitHub commit queries, including author-date: and committer-date: qualifiers, or GitLab message keywords; narrow the query when incomplete is true or totalCount exceeds resultLimit.",
      ],
      ...effect("forges_commits_search"),
      input: schemas.commitSearchParameters,
      execute: (args) => call((operations) => operations.searchCommits(args)),
    }),
    defineTool({
      name: "forges_commits_list",
      title: forgeToolTitle("forges_commits_list", "List Commits"),
      description:
        "List paged commit summaries for one repository, optionally filtered by ref, path, and ISO-8601 since/until dates. Summaries omit changed-file rows and cut each message to its subject line, with messageTruncated on the cut ones, and leave out a committer identical to the author; use forges_commits_get for one commit's files or full message. Gitea rejects path because that API ignores pagination limits for the filter; Forgejo paginates it. Cloudflare Artifacts filters by ref alone and rejects path, since and until.",
      snippet:
        "Read repository commit history from GitHub, GitLab, Gitea, or Cloudflare Artifacts.",
      guidelines: [
        "Use forges_commits_list for repository history; use forges_commits_get only when one commit's changed files or full message are needed.",
        "forges_commits_list rejects path on Gitea because that API ignores pagination limits for the filter; Forgejo paginates it.",
      ],
      ...effect("forges_commits_list"),
      input: schemas.listCommitsParameters,
      execute: (args) => call((operations) => operations.listCommits(args)),
    }),
    defineTool({
      name: "forges_commits_compare",
      title: forgeToolTitle("forges_commits_compare", "Compare Commits"),
      description:
        "Compare two refs: the commits head has that base lacks, as git log base..head lists them, oldest first, with aheadBy and totalCount for the whole range. Messages are cut to their subject line, with messageTruncated on the cut ones, and a committer identical to the author is left out. Pass files to get the net change from the merge base to head with per-file counts on the first page; later pages have files null. GitHub also reports status, behindBy and mergeBaseSha, and lists at most 300 files, so filesComplete is null at that cap. GitLab and Gitea return null for status, behindBy, mergeBaseSha and filesComplete; Gitea has no range file list, so files is null there. To ask what head lacks, swap base and head.",
      snippet:
        "Compare two branches, tags, or commits on GitHub, GitLab, or Gitea without a checkout.",
      guidelines: [
        "Use forges_commits_compare for the commits and files between two refs, such as a tag and main for release notes, instead of listing history and filtering by hand.",
        "forges_commits_compare reports behindBy only on GitHub; elsewhere swap base and head to see what head lacks.",
      ],
      ...effect("forges_commits_compare"),
      input: schemas.compareCommitsParameters,
      execute: (args) => call((operations) => operations.compareCommits(args)),
    }),
    defineTool({
      name: "forges_commits_get",
      title: forgeToolTitle("forges_commits_get", "Get Commit"),
      description:
        "Get one commit by SHA with normalized author, committer, parent revisions, message, URL, and changed-file rows. Patches are omitted; per-file counts are null when the provider does not report them, and filesComplete is null when provider or safety limits make completeness unknowable. Cloudflare Artifacts reports no changed files, so files is empty there and filesComplete null.",
      snippet:
        "Read one commit from GitHub, GitLab, Gitea, or Cloudflare Artifacts, with its changed files where the host lists them.",
      guidelines: [
        "Use forges_commits_get when a known commit SHA needs exact metadata or changed paths.",
      ],
      ...effect("forges_commits_get"),
      input: schemas.commitParameters,
      execute: (args) => call((operations) => operations.getCommit(args)),
    }),
    defineTool({
      name: "forges_commits_patch",
      title: forgeToolTitle("forges_commits_patch", "Read Commit Patch"),
      description:
        "Read one bounded slice of a known commit's patch stream. Continue with the returned sha, nextOffset, and the same non-null path. Each slice repeats provider pagination, so use the largest practical maxChars. Binary files, provider-omitted patches, and output truncation are labeled separately.",
      snippet: "Read code changes from one known commit without materializing an unbounded diff.",
      guidelines: [
        "Use forges_commits_patch for bounded patch slices. Continue with the returned sha, nextOffset, and same non-null path, not the original branch or tag.",
      ],
      ...effect("forges_commits_patch"),
      input: schemas.commitPatchParameters,
      execute: (args) => call((operations) => operations.readCommitPatch(args)),
    }),
    defineTool({
      name: "forges_releases_list",
      title: forgeToolTitle("forges_releases_list", "List Releases"),
      description:
        "List the releases of one repository, newest first, each with its tag, title, draft and pre-release flags, author, creation and publication time, and URL. Release notes are omitted here; read one with forges_releases_get. Drafts appear only for a token with push access, and GitLab has neither drafts nor pre-releases, so both flags are false there.",
      snippet: "List releases from GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_releases_list to see which tags have a release; notes come from forges_releases_get.",
      ],
      ...effect("forges_releases_list"),
      input: schemas.listReleasesParameters,
      execute: (args) => call((operations) => operations.listReleases(args)),
    }),
    defineTool({
      name: "forges_releases_get",
      title: forgeToolTitle("forges_releases_get", "Get Release"),
      description:
        "Get one release by its tag name with the full release notes. The tag is the key on every platform, because GitLab releases have no id of their own; the id field is the platform id on GitHub and Gitea and the tag on GitLab. A GitHub draft is found among the 500 newest releases when the token may see drafts.",
      snippet: "Read one release by tag from GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_releases_get with the tag name; releases are keyed by tag on every platform.",
      ],
      ...effect("forges_releases_get"),
      input: schemas.releaseParameters,
      execute: (args) => call((operations) => operations.getRelease(args)),
    }),
    defineTool({
      name: "forges_releases_create",
      title: forgeToolTitle("forges_releases_create", "Create Release"),
      description:
        "Create a release for a tag, creating the tag from ref when it does not exist yet. A release that is not a draft is public the moment it lands and notifies watchers, so confirm the tag, the notes, and the target with the user first; this writes as the account the local credentials belong to. GitLab has no drafts or pre-releases and rejects either flag set to true instead of publishing.",
      snippet: "Create a release on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_releases_create only when the user explicitly asks to publish a release; a non-draft release is public at once.",
      ],
      ...effect("forges_releases_create"),
      input: schemas.createReleaseParameters,
      execute: (args) => call((operations) => operations.createRelease(args)),
    }),
    defineTool({
      name: "forges_releases_update",
      title: forgeToolTitle("forges_releases_update", "Update Release"),
      description:
        "Update the title, notes, draft or pre-release flag of the release behind one tag. Pass at least one of them; omitted fields keep their value. This overwrites what is there and writes as the account the local credentials belong to, so read the release first and confirm the new text with the user. A GitHub draft is found the way forges_releases_get finds it, among the 500 newest releases. GitLab rejects draft or prerelease set to true.",
      snippet: "Edit a release's title or notes on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_releases_update only when the user explicitly asks to change a release; read it with forges_releases_get first, the new text replaces the old.",
      ],
      ...effect("forges_releases_update"),
      input: schemas.updateReleaseParameters,
      execute: (args) => call((operations) => operations.updateRelease(args)),
    }),
    defineTool({
      name: "forges_issues_list",
      title: forgeToolTitle("forges_issues_list", "List Issues"),
      description:
        "List normalized issues for one repository, optionally filtered by state. Issue bodies are omitted here so one page cannot flood the context; read a single body with forges_issues_get. GitHub serves pull requests from the same endpoint and they are dropped after the page is cut, so an empty page whose hasNextPage is true means keep paging, not that the repository has no issues.",
      snippet: "List repository issues across GitHub, GitLab, or Gitea.",
      guidelines: ["Use forges_issues_list to inspect issue queues across supported platforms."],
      ...effect("forges_issues_list"),
      input: schemas.listRepositoryItemsParameters,
      execute: (args) => call((operations) => operations.listIssues(args)),
    }),
    defineTool({
      name: "forges_issues_search_global",
      title: forgeToolTitle("forges_issues_search_global", "Search Issues Across Repositories"),
      description:
        "Search issues across repositories, optionally scoped to an owner or one repository. GitHub takes sort/order (created/desc for newest) and caps hits at resultLimit 1000; Gitea matches keywords, always newest first; GitLab matches keywords, sorted by created or updated, and takes a group as owner. Gitea and GitLab set resultLimit null. author, state and labels filter on every platform, and an issue must carry every label. Pull requests never appear. Returns repository identity, totalCount and incomplete. Follow nextPage while hasNextPage is true; narrow the query when incomplete is true.",
      snippet: "Find issues across an owner's repositories, filtered by label, state or author.",
      guidelines: [
        "Use forges_issues_search_global for triage across an owner's repositories instead of looping forges_issues_search over each one; narrow the query when incomplete is true.",
      ],
      ...effect("forges_issues_search_global"),
      input: schemas.globalIssueSearchParameters,
      execute: (args) => call((operations) => operations.searchIssuesGlobal(args)),
    }),
    defineTool({
      name: "forges_issues_search",
      title: forgeToolTitle("forges_issues_search", "Search Issues"),
      description:
        "Search issues inside one repository with the selected platform's query syntax, optionally filtered by state. Bodies are omitted; read one result with forges_issues_get. Results are paged, and incomplete says whether the search is known to be partial.",
      snippet: "Search issues inside one GitHub, GitLab, or Gitea repository.",
      guidelines: [
        "Use forges_issues_search when duplicate checks need a query instead of the whole issue queue.",
      ],
      ...effect("forges_issues_search"),
      input: schemas.searchRepositoryItemsParameters,
      execute: (args) => call((operations) => operations.searchIssues(args)),
    }),
    defineTool({
      name: "forges_issues_get",
      title: forgeToolTitle("forges_issues_get", "Get Issue"),
      description:
        "Get one issue by number, including its body. The number is the one the web UI shows, which on GitLab is the project-scoped iid rather than the global id.",
      snippet: "Get one repository issue from GitHub, GitLab, or Gitea.",
      guidelines: ["Use forges_issues_get when the exact issue number is known."],
      ...effect("forges_issues_get"),
      input: schemas.repositoryItemParameters,
      execute: (args) => call((operations) => operations.getIssue(args)),
    }),
    defineTool({
      name: "forges_issues_comments",
      title: forgeToolTitle("forges_issues_comments", "List Issue Comments"),
      description:
        "List the discussion comments under one issue, oldest first. Comment bodies are truncated here; read one whole with forges_issues_comments_get. Ask for a small perPage on a busy issue and follow hasNextPage. GitLab system notes about label and state churn are dropped, so a short page whose hasNextPage is true means keep paging, not that the discussion ended.",
      snippet: "Read the discussion under an issue on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_issues_comments to read an issue's discussion instead of scraping the web UI.",
      ],
      ...effect("forges_issues_comments"),
      input: schemas.listCommentsParameters,
      execute: (args) => call((operations) => operations.listIssueComments(args)),
    }),
    defineTool({
      name: "forges_issues_comments_get",
      title: forgeToolTitle("forges_issues_comments_get", "Get Issue Comment"),
      description:
        "Get one discussion comment under an issue, with its full body. The id is the one forges_issues_comments returned for it.",
      snippet: "Read one issue comment in full on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_issues_comments_get with an id from forges_issues_comments when the truncated body is not enough.",
      ],
      ...effect("forges_issues_comments_get"),
      input: schemas.commentParameters,
      execute: (args) => call((operations) => operations.getIssueComment(args)),
    }),
    defineTool({
      name: "forges_issues_comments_create",
      title: forgeToolTitle("forges_issues_comments_create", "Comment on Issue"),
      description:
        "Post a new comment in one issue's discussion. It writes as the account the local credentials belong to, and a second call posts a second comment, so confirm the text with the user first. Returns the comment as stored, with the id forges_issues_comments_get reads.",
      snippet: "Comment on an issue on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_issues_comments_create only when the user explicitly asks to comment on an issue; a second call posts a second comment.",
      ],
      ...effect("forges_issues_comments_create"),
      input: schemas.createCommentParameters,
      execute: (args) => call((operations) => operations.createIssueComment(args)),
    }),
    defineTool({
      name: "forges_issues_create",
      title: forgeToolTitle("forges_issues_create", "Create Issue"),
      description:
        "Create an issue in one repository. This writes to the hosted platform as the account the local credentials belong to, so confirm the target with the user first; forges_users_authenticated names that account.",
      snippet: "Create a repository issue on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_issues_create only when the user explicitly asks to create an issue.",
      ],
      ...effect("forges_issues_create"),
      input: schemas.createIssueParameters,
      execute: (args) => call((operations) => operations.createIssue(args)),
    }),
    defineTool({
      name: "forges_issues_update",
      title: forgeToolTitle("forges_issues_update", "Update Issue"),
      description:
        "Change an issue: its title, its body, its open or closed state, and assignees or labels to add or remove. Pass at least one change; everything not named keeps its value. A new body replaces the old one, so read the issue first and confirm the text with the user; this writes as the account the local credentials belong to. Returns the issue as it is after the update, with a note when an assignee change did not apply.",
      snippet: "Edit or close an issue on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_issues_update only when the user explicitly asks to change an issue; read it with forges_issues_get first, a new body replaces the old one.",
      ],
      ...effect("forges_issues_update"),
      input: schemas.updateIssueParameters,
      execute: (args) => call((operations) => operations.updateIssue(args)),
    }),
    defineTool({
      name: "forges_pull_requests_list",
      title: forgeToolTitle("forges_pull_requests_list", "List Pull Requests"),
      description:
        "List normalized pull requests, which GitLab calls merge requests, for one repository, optionally filtered by state. Bodies are omitted here; read a single body with forges_pull_requests_get.",
      snippet: "List repository pull requests across GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_pull_requests_list to inspect pull-request queues across supported platforms.",
      ],
      ...effect("forges_pull_requests_list"),
      input: schemas.listRepositoryItemsParameters,
      execute: (args) => call((operations) => operations.listPullRequests(args)),
    }),
    defineTool({
      name: "forges_pull_requests_search_global",
      title: forgeToolTitle(
        "forges_pull_requests_search_global",
        "Search Pull Requests Across Repositories",
      ),
      description:
        "Search pull requests across repositories, optionally scoped to an owner or one repository. GitHub takes sort/order (created/desc for newest) and caps hits at resultLimit 1000; Gitea matches keywords, always newest first; GitLab matches keywords, sorted by created or updated, and takes a group as owner. Gitea and GitLab set resultLimit null. author filters by login on every platform. Returns repository identity, totalCount and incomplete. Follow nextPage while hasNextPage is true; narrow the query when incomplete is true.",
      snippet: "Find an author's pull requests across repositories, optionally newest first.",
      guidelines: [
        "Use forges_pull_requests_search_global with author, sort created and order desc for recent author contributions; narrow the query when incomplete is true.",
      ],
      ...effect("forges_pull_requests_search_global"),
      input: schemas.globalPullRequestSearchParameters,
      execute: (args) => call((operations) => operations.searchPullRequestsGlobal(args)),
    }),
    defineTool({
      name: "forges_pull_requests_search",
      title: forgeToolTitle("forges_pull_requests_search", "Search Pull Requests"),
      description:
        "Search pull requests inside one repository with the selected platform's query syntax, optionally filtered by state. Bodies and revision details are omitted; read one result with forges_pull_requests_get. Results are paged, and incomplete says whether the search is known to be partial.",
      snippet: "Search pull requests inside one GitHub, GitLab, or Gitea repository.",
      guidelines: [
        "Use forges_pull_requests_search for duplicate checks by query inside one repository.",
      ],
      ...effect("forges_pull_requests_search"),
      input: schemas.searchRepositoryItemsParameters,
      execute: (args) => call((operations) => operations.searchPullRequests(args)),
    }),
    defineTool({
      name: "forges_pull_requests_get",
      title: forgeToolTitle("forges_pull_requests_get", "Get Pull Request"),
      description:
        "Get one pull request, called a merge request on GitLab, by number: body, branches, head revision, draft and merged state, mergeability, provider merge status, and the landed merge commit SHA. Pass closingIssues to also list the issues it closes on merge.",
      snippet: "Get one pull request from GitHub, GitLab, or Gitea.",
      guidelines: ["Use forges_pull_requests_get when the exact pull-request number is known."],
      ...effect("forges_pull_requests_get"),
      input: schemas.pullRequestParameters,
      execute: (args) => call((operations) => operations.getPullRequest(args)),
    }),
    defineTool({
      name: "forges_pull_requests_files",
      title: forgeToolTitle("forges_pull_requests_files", "List Pull Request Files"),
      description:
        "List files changed by one pull request, normalized to path, status, additions, and deletions. Patches are omitted. GitLab counts are null when it withholds a collapsed or oversized diff.",
      snippet: "Read changed-file paths and counts for a pull request.",
      guidelines: [
        "Use forges_pull_requests_files when a review or audit needs the pull request's changed paths and line counts.",
      ],
      ...effect("forges_pull_requests_files"),
      input: schemas.listPullRequestFilesParameters,
      execute: (args) => call((operations) => operations.listPullRequestFiles(args)),
    }),
    defineTool({
      name: "forges_pull_requests_checks",
      title: forgeToolTitle("forges_pull_requests_checks", "List Pull Request Checks"),
      description:
        "List the checks or pipelines associated with one pull request head revision, normalized to name, lifecycle status, terminal conclusion, and URL. On GitHub the rows are the commit statuses followed by the check runs, so a CLA bot or a Jenkins job that branch protection requires is listed too. A host without check runs, GitBucket for one, returns those statuses and treats the missing route as an empty list. On GitLab they are the merge request pipelines on the head plus its head_pipeline, which is how a merged results or merge train pipeline is found. Pass waitSeconds instead of polling this tool: the call then returns once every check of the pull request concludes, or when the budget ends, carrying a wait field with settled, waitedMs, polls, and the names still pending. " +
        `An empty list settles at once only on a pull request unchanged for ${EMPTY_CHECK_GRACE_SECONDS} seconds, otherwise after the wait sits ${EMPTY_CHECK_GRACE_SECONDS} seconds out, so a call right after a push waits for CI to list its first check; wait.noChecks says quiet or waited.`,
      snippet: "Read the checks for a pull request on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_pull_requests_checks to verify pull-request CI before merging or reviewing.",
        "Give forges_pull_requests_checks a waitSeconds budget rather than calling it again to see whether a running check finished.",
      ],
      ...effect("forges_pull_requests_checks"),
      input: schemas.listPullRequestChecksParameters,
      execute: (args) => call((operations) => operations.listPullRequestChecks(args)),
    }),
    defineTool({
      name: "forges_pull_requests_reviews",
      title: forgeToolTitle("forges_pull_requests_reviews", "List Pull Request Reviews"),
      description:
        "List the reviews given on one pull request, each normalized to approved, changes_requested, commented, dismissed, or pending, with its author, body, reviewed revision, time, and URL. Unanswered review requests are left out, and GitLab entries are its approvals plus each reviewer's stance. Bodies are truncated here; use forges_pull_requests_reviews_get for a full GitHub or Gitea review. Inline comments are the threads forges_threads_list reads.",
      snippet: "Read the reviews on a pull request on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_pull_requests_reviews to see who approved or requested changes before calling a pull request ready.",
      ],
      ...effect("forges_pull_requests_reviews"),
      input: schemas.listPullRequestReviewsParameters,
      execute: (args) => call((operations) => operations.listPullRequestReviews(args)),
    }),
    defineTool({
      name: "forges_pull_requests_reviews_get",
      title: forgeToolTitle("forges_pull_requests_reviews_get", "Get Pull Request Review"),
      description:
        "Get one pull request review with its full body, author, verdict, revision, time and URL. Use a review id from forges_pull_requests_reviews. GitHub and Gitea support this read; GitLab reviewer stances have no individual review body and return an unsupported error.",
      snippet: "Read a complete review by its id on GitHub or Gitea.",
      guidelines: [
        "Use forges_pull_requests_reviews_get when the reviews list truncates a body; GitLab reviewer stances have no full review to read.",
      ],
      ...effect("forges_pull_requests_reviews_get"),
      input: schemas.pullRequestReviewParameters,
      execute: (args) => call((operations) => operations.getPullRequestReview(args)),
    }),
    defineTool({
      name: "forges_pull_requests_comments",
      title: forgeToolTitle("forges_pull_requests_comments", "List Pull Request Comments"),
      description:
        "List the conversation comments under one pull request, oldest first: the discussion, not the code-review threads that forges_threads_list reads. Comment bodies are truncated here; read one whole with forges_pull_requests_comments_get, and bound the volume with perPage and hasNextPage.",
      snippet: "Read the conversation under a pull request on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_pull_requests_comments for the pull-request conversation; review threads come from forges_threads_list.",
      ],
      ...effect("forges_pull_requests_comments"),
      input: schemas.listCommentsParameters,
      execute: (args) => call((operations) => operations.listPullRequestComments(args)),
    }),
    defineTool({
      name: "forges_pull_requests_comments_get",
      title: forgeToolTitle("forges_pull_requests_comments_get", "Get Pull Request Comment"),
      description:
        "Get one conversation comment under a pull request, with its full body. The id is the one forges_pull_requests_comments returned; review-thread comments come back whole from forges_threads_get instead.",
      snippet: "Read one pull-request conversation comment in full on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_pull_requests_comments_get with an id from forges_pull_requests_comments; review threads still come back whole from forges_threads_get.",
      ],
      ...effect("forges_pull_requests_comments_get"),
      input: schemas.commentParameters,
      execute: (args) => call((operations) => operations.getPullRequestComment(args)),
    }),
    defineTool({
      name: "forges_pull_requests_comments_create",
      title: forgeToolTitle("forges_pull_requests_comments_create", "Comment on Pull Request"),
      description:
        "Post a new conversation comment on one pull request. It lands in the discussion, not in a review thread; answer a thread with forges_threads_reply. It writes as the account the local credentials belong to, and a second call posts a second comment, so confirm the text with the user first. Returns the comment as stored, with the id forges_pull_requests_comments_get reads.",
      snippet: "Comment on a pull request on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_pull_requests_comments_create only when the user explicitly asks to comment on a pull request; answer a review thread with forges_threads_reply instead.",
      ],
      ...effect("forges_pull_requests_comments_create"),
      input: schemas.createCommentParameters,
      execute: (args) => call((operations) => operations.createPullRequestComment(args)),
    }),
    defineTool({
      name: "forges_pull_requests_create",
      title: forgeToolTitle("forges_pull_requests_create", "Create Pull Request"),
      description:
        "Open a pull request, a GitLab merge request, from one branch onto another. This writes to the hosted platform as the account the local credentials belong to, so confirm the branches and the target with the user first.",
      snippet: "Create a pull request on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_pull_requests_create only when the user explicitly asks to create a pull request.",
      ],
      ...effect("forges_pull_requests_create"),
      input: schemas.createPullRequestParameters,
      execute: (args) => call((operations) => operations.createPullRequest(args)),
    }),
    defineTool({
      name: "forges_pull_requests_update",
      title: forgeToolTitle("forges_pull_requests_update", "Update Pull Request"),
      description:
        "Change a pull request: its title, its body, its open or closed state, and assignees or labels to add or remove. Pass at least one change; everything not named keeps its value. A new body replaces the old one, so read the pull request first and confirm the text with the user; this writes as the account the local credentials belong to. Returns the pull request as it is after the update, with a note when an assignee change did not apply.",
      snippet: "Edit a pull request on GitHub, GitLab, or Gitea after it is open.",
      guidelines: [
        "Use forges_pull_requests_update only when the user explicitly asks to change a pull request; read it with forges_pull_requests_get first, a new body replaces the old one.",
      ],
      ...effect("forges_pull_requests_update"),
      input: schemas.updatePullRequestParameters,
      execute: (args) => call((operations) => operations.updatePullRequest(args)),
    }),
    defineTool({
      name: "forges_pull_requests_merge",
      title: forgeToolTitle("forges_pull_requests_merge", "Merge Pull Request"),
      description:
        "Merge an open pull request, a GitLab merge request, into its target branch as the account the local credentials belong to. A merge cannot be taken back, so merge only when the user asks, after the reviews and forges_pull_requests_checks, and pass the headSha those ran on: a push after them then fails the merge instead of landing unseen. Returns the pull request as it is after the merge, with its merge commit.",
      snippet: "Merge a pull request on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_pull_requests_merge only when the user explicitly asks to merge; check forges_pull_requests_checks first and pass the headSha they ran on.",
      ],
      ...effect("forges_pull_requests_merge"),
      input: schemas.mergePullRequestParameters,
      execute: (args) => call((operations) => operations.mergePullRequest(args)),
    }),
    defineTool({
      name: "forges_users_get",
      title: forgeToolTitle("forges_users_get", "Get User"),
      description:
        "Get one normalized user profile by username: display name, bio, company, location, website, follower counts, account creation date, profile URL, email, avatar URL, admin flag, and platform id.",
      snippet: "Get a user profile from GitHub, GitLab, or Gitea.",
      guidelines: ["Use forges_users_get to resolve a platform username to normalized metadata."],
      ...effect("forges_users_get"),
      input: schemas.userParameters,
      execute: (args) => call((operations) => operations.getUser(args)),
    }),
    defineTool({
      name: "forges_users_authenticated",
      title: forgeToolTitle("forges_users_authenticated", "Get Authenticated User"),
      description:
        "Get the profile of the account the locally detected credentials belong to. Call this before writing anything, because every write lands under that account and the server never takes a token as an argument. With account, it checks that GitHub login instead, as a write naming it would. The credential stays pinned until forges_auth_reload explicitly replaces it.",
      snippet: "Identify the authenticated GitHub, GitLab, or Gitea account.",
      guidelines: [
        "Use forges_users_authenticated to identify the account selected by trusted local authentication.",
      ],
      ...effect("forges_users_authenticated"),
      input: schemas.authenticatedUserParameters,
      execute: (args) => call((operations) => operations.getAuthenticatedUser(args)),
    }),
    defineTool({
      name: "forges_auth_reload",
      title: forgeToolTitle("forges_auth_reload", "Reload Authentication"),
      description:
        "Replace the local credential pinned for one platform, then return the newly authenticated profile. This changes server state but writes nothing to the Git host.",
      snippet: "Reload a Git platform credential after an intentional local account switch.",
      guidelines: [
        "Use forges_auth_reload only after the user intentionally changes trusted local authentication.",
      ],
      ...effect("forges_auth_reload"),
      input: schemas.authenticatedUserParameters,
      execute: (args) => call((operations) => operations.reloadAuthentication(args)),
    }),
    defineTool({
      name: "forges_threads_list",
      title: forgeToolTitle("forges_threads_list", "List Review Threads"),
      description:
        "List the review threads on one pull request, optionally filtered by resolved state. Comment bodies are truncated here; read one thread whole with forges_threads_get. Gitea carries no parent id on review comments, so each comment comes back as its own single-comment thread there.",
      snippet: "List review threads on a pull request across GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_threads_list to inspect review threads instead of dumping full PR comments.",
      ],
      ...effect("forges_threads_list"),
      input: schemas.listThreadsParameters,
      execute: (args) => call((operations) => operations.listThreads(args)),
    }),
    defineTool({
      name: "forges_threads_get",
      title: forgeToolTitle("forges_threads_get", "Get Review Thread"),
      description:
        "Get one review thread by the exact id that forges_threads_list returned, with every comment body in full. Thread ids are platform-specific opaque strings, so never construct one.",
      snippet: "Get one review thread from GitHub, GitLab, or Gitea.",
      guidelines: ["Use forges_threads_get when the exact review thread id is known."],
      ...effect("forges_threads_get"),
      input: schemas.threadParameters,
      execute: (args) => call((operations) => operations.getThread(args)),
    }),
    defineTool({
      name: "forges_threads_reply",
      title: forgeToolTitle("forges_threads_reply", "Reply to Review Thread"),
      description:
        "Post a reply inside an existing review thread, keeping the answer attached to the code it discusses instead of adding a standalone pull-request comment. This writes to the hosted platform under the local credentials.",
      snippet: "Reply inside a review thread on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_threads_reply to answer inside the thread, not as a standalone pull-request comment.",
      ],
      ...effect("forges_threads_reply"),
      input: schemas.replyThreadParameters,
      execute: (args) => call((operations) => operations.replyToThread(args)),
    }),
    defineTool({
      name: "forges_threads_resolve",
      title: forgeToolTitle("forges_threads_resolve", "Resolve Review Thread"),
      description:
        "Mark one review thread resolved. This writes to the hosted platform under the local credentials, so resolve a thread only after the point it raised has actually been addressed.",
      snippet: "Resolve a review thread on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_threads_resolve only when the user explicitly asks to resolve a thread.",
      ],
      ...effect("forges_threads_resolve"),
      input: schemas.threadStateParameters,
      execute: (args) => call((operations) => operations.resolveThread(args)),
    }),
    defineTool({
      name: "forges_threads_unresolve",
      title: forgeToolTitle("forges_threads_unresolve", "Unresolve Review Thread"),
      description:
        "Reopen one resolved review thread. This writes to the hosted platform under the local credentials.",
      snippet: "Unresolve a review thread on GitHub, GitLab, or Gitea.",
      guidelines: [
        "Use forges_threads_unresolve only when the user explicitly asks to reopen a thread.",
      ],
      ...effect("forges_threads_unresolve"),
      input: schemas.threadStateParameters,
      execute: (args) => call((operations) => operations.unresolveThread(args)),
    }),
    defineTool({
      name: "forges_local_inspect",
      title: forgeToolTitle("forges_local_inspect", "Inspect Local Repository"),
      description:
        "Read local Git status, tracked paths and recent HEAD commit messages. Status rows and tracked paths page separately: follow nextStatusOffset or nextFilesOffset until null, keeping paths unchanged. No fetch or writes; concurrent edits can change pagination.",
      snippet: "Read local status, tracked files and path history without shell chains.",
      guidelines: [
        "Use forges_local_inspect for local Git status and path history; paths are Git pathspecs, not shell commands.",
      ],
      ...effect("forges_local_inspect"),
      input: schemas.localInspectParameters,
      execute: (args) => call((operations) => operations.inspectLocal(args)),
    }),
    defineTool({
      name: "forges_local_merge_verify",
      title: forgeToolTitle("forges_local_merge_verify", "Verify Local Merge"),
      description:
        "Read local Git ancestry and compare selected paths between a PR head and its merge commit. No fetch or writes. This is not permission to delete a branch.",
      snippet: "Verify merge ancestry and selected file contents in a local checkout.",
      guidelines: [
        "Use forges_local_merge_verify after fetching the target ref; matching paths alone never authorizes branch deletion.",
      ],
      ...effect("forges_local_merge_verify"),
      input: schemas.localMergeParameters,
      execute: (args) => call((operations) => operations.verifyLocalMerge(args)),
    }),
  ];
}

import { Type, type TObject, type TProperties } from "typebox";

/**
 * The platforms every tool surface accepts, re-exported from `src/tool-operations.ts`.
 *
 * The union is declared here rather than imported from `src/`, because this file
 * ships to npm and `src/` does not: a type import pointing back into the source
 * tree would dangle in the published package.
 */
export type ForgesPlatform = "github" | "gitlab" | "gitea";

/**
 * Build the parameter schemas for the forges tool surface.
 *
 * Pi and the MCP server share these schemas and call this once, when they
 * register their tools, so importing the module evaluates nothing. The OMP
 * extension builds its own copies from `ExtensionAPI.typebox`, because OMP
 * validates tool parameters with its host TypeBox build rather than this one.
 *
 * No schema carries a token or a base URL: credentials come from the local
 * detection chain and endpoints from the `FORGES_*_BASE_URL` variables, so a
 * model can never point an operation at a host of its choosing.
 */
export function forgesToolSchemas() {
  const platform = Type.Optional(
    Type.Unsafe<ForgesPlatform>({
      type: "string",
      enum: ["github", "gitlab", "gitea"],
      description: "Git hosting platform; defaults to github",
      default: "github",
    }),
  );
  /** Repository tools take the owner inside `repo` as readily as on its own field. */
  const owner = Type.Optional(
    Type.String({
      description: 'Repository owner or organization; omit when repo is written "owner/name"',
      minLength: 1,
    }),
  );
  /** Listing an account's repositories has no repo to carry the owner. */
  const accountOwner = Type.String({
    description: "Repository owner or organization",
    minLength: 1,
  });
  const repo = Type.String({
    description: 'Repository name, or "owner/name" when owner is omitted',
    minLength: 1,
  });
  const contributionTemplateKind = Type.Unsafe<"issue" | "pull_request">({
    type: "string",
    enum: ["issue", "pull_request"],
    description: "Contribution template kind",
  });
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
    Type.Unsafe<"open" | "closed" | "all">({
      type: "string",
      enum: ["open", "closed", "all"],
      description: "Filter by state",
    }),
  );
  const number = Type.Integer({ description: "Issue or pull-request number", minimum: 1 });
  const threadState = Type.Optional(
    Type.Unsafe<"unresolved" | "resolved" | "all">({
      type: "string",
      enum: ["unresolved", "resolved", "all"],
      description: "Filter by resolved state",
    }),
  );
  const threadId = Type.String({ description: "Review thread id", minLength: 1 });
  const commentId = Type.String({ description: "Discussion comment id", minLength: 1 });
  const assignees = Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description: "Assignee logins. GitLab Free accepts only one.",
      maxItems: 10,
    }),
  );

  /** Only gh hands out a named login's token, so the other platforms reject it. */
  const account = Type.Optional(
    Type.String({
      description:
        "GitHub login to act as; refused unless the local credential belongs to it. Omit for the pinned one.",
      minLength: 1,
    }),
  );

  /** A closed object rejects a stray `per_page` instead of quietly shrinking the page. */
  function closed<T extends TProperties>(properties: T): TObject<T> {
    return Type.Object(properties, { additionalProperties: false });
  }

  const listRepositoriesParameters = closed({ platform, owner: accountOwner, page, perPage });
  const repositoryParameters = closed({ platform, owner, repo });
  const repositoryContentsParameters = closed({
    platform,
    owner,
    repo,
    path: Type.String({
      description: 'File or directory path; "" or "/" reads the repository root',
    }),
    ref: Type.Optional(
      Type.String({
        description:
          "Branch, tag or commit SHA; defaults to the default branch. Continue a file with the returned sha",
        minLength: 1,
      }),
    ),
    offset: Type.Optional(
      Type.Integer({
        description:
          "UTF-16 code-unit offset returned by the previous slice; continue with its sha as ref",
        minimum: 0,
      }),
    ),
    maxChars: Type.Optional(
      Type.Integer({
        description: "Maximum file UTF-16 code units to return; defaults to 20000",
        minimum: 1,
        maximum: 200000,
      }),
    ),
  });
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
    owner,
    repo: Type.Optional(repo),
    page,
    perPage,
  });
  const globalPullRequestSearchParameters = closed({
    platform,
    query: Type.Optional(
      Type.String({
        description:
          "Native pull-request query: qualifiers such as created: on GitHub, keywords on Gitea and GitLab. Optional with author",
        minLength: 1,
      }),
    ),
    author: Type.Optional(
      Type.String({
        description: "Login of the pull request author, on every platform",
        minLength: 1,
      }),
    ),
    owner,
    repo: Type.Optional(repo),
    page,
    perPage,
    sort: Type.Optional(
      Type.Unsafe<"created" | "updated" | "comments">({
        type: "string",
        enum: ["created", "updated", "comments"],
        description: "Sort field; omit for best match",
      }),
    ),
    order: Type.Optional(
      Type.Unsafe<"asc" | "desc">({
        type: "string",
        enum: ["asc", "desc"],
        description: "Sort direction; defaults to desc",
      }),
    ),
  });
  const commitSearchParameters = closed({
    platform,
    query: Type.String({
      description: "Native commit query, including author-date: or committer-date: qualifiers",
      minLength: 1,
    }),
    owner,
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
        description:
          "UTF-16 code-unit offset returned by the previous slice; continue with its sha and same path",
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
  const listCiJobsParameters = closed({
    platform,
    owner,
    repo,
    runId: Type.String({
      description: "CI run id from forges_ci_runs_list; a pipeline id on GitLab",
      minLength: 1,
    }),
    page,
    perPage,
  });
  const ciJobLogParameters = closed({
    platform,
    owner,
    repo,
    jobId: Type.String({
      description:
        "CI job id from forges_ci_jobs_list; on GitHub a check id from forges_pull_requests_checks works too",
      minLength: 1,
    }),
    offset: Type.Optional(
      Type.Integer({
        description: "UTF-16 code-unit offset returned by the previous slice",
        minimum: 0,
      }),
    ),
    maxChars: Type.Optional(
      Type.Integer({
        description: "Maximum log UTF-16 code units to return; defaults to 20000",
        minimum: 1,
        maximum: 200000,
      }),
    ),
  });
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
    account,
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
    account,
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
  const pullRequestParameters = closed({
    platform,
    owner,
    repo,
    number,
    closingIssues: Type.Optional(
      Type.Boolean({
        description:
          "Also list the issues the pull request closes on merge, at the cost of one more request; null where the platform cannot tell",
      }),
    ),
  });
  const listCommentsParameters = closed({ platform, owner, repo, number, page, perPage });
  /**
   * The waiting mode of the check listing. The bound repeats
   * `MAX_CHECK_WAIT_SECONDS` from `src/check-wait.ts`, which this file cannot
   * import: it ships to npm and `src/` does not.
   */
  const waitSeconds = Type.Optional(
    Type.Integer({
      description:
        "Wait up to this many seconds for every check to conclude, instead of reading the current state once",
      minimum: 1,
      maximum: 300,
    }),
  );
  const listPullRequestFilesParameters = listCommentsParameters;
  const listPullRequestChecksParameters = closed({
    platform,
    owner,
    repo,
    number,
    page,
    perPage,
    waitSeconds,
  });
  const listPullRequestReviewsParameters = listCommentsParameters;
  const pullRequestReviewParameters = closed({
    platform,
    owner,
    repo,
    number,
    reviewId: Type.String({ description: "Review id returned by the reviews list", minLength: 1 }),
  });
  const commentParameters = closed({ platform, owner, repo, number, commentId });
  const createCommentParameters = closed({
    platform,
    owner,
    repo,
    number,
    body: Type.String({ description: "Comment body in the platform's Markdown", minLength: 1 }),
    account,
  });
  const createIssueParameters = closed({
    platform,
    owner,
    repo,
    title: Type.String({ description: "Issue title", minLength: 1 }),
    body: Type.String({ description: "Issue body" }),
    labels: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    assignees,
    account,
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
    account,
  });
  const listChanges = {
    addAssignees: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "Logins to assign next to the current ones. GitLab Free keeps one.",
        maxItems: 10,
      }),
    ),
    removeAssignees: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "Logins to unassign; the others stay",
        maxItems: 10,
      }),
    ),
    addLabels: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "Label names to add next to the current ones",
        maxItems: 100,
      }),
    ),
    removeLabels: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "Label names to remove; the others stay",
        maxItems: 100,
      }),
    ),
  };
  const updateIssueParameters = closed({
    platform,
    owner,
    repo,
    number,
    title: Type.Optional(Type.String({ description: "New issue title", minLength: 1 })),
    body: Type.Optional(Type.String({ description: "New issue body; replaces the old one" })),
    state: Type.Optional(
      Type.Unsafe<"open" | "closed">({
        type: "string",
        enum: ["open", "closed"],
        description: "Close or reopen",
      }),
    ),
    ...listChanges,
    account,
  });
  const updatePullRequestParameters = closed({
    platform,
    owner,
    repo,
    number,
    title: Type.Optional(Type.String({ description: "New pull-request title", minLength: 1 })),
    body: Type.Optional(
      Type.String({ description: "New pull-request body; replaces the old one" }),
    ),
    state: Type.Optional(
      Type.Unsafe<"open" | "closed">({
        type: "string",
        enum: ["open", "closed"],
        description: "Close or reopen; a merged pull request stays merged",
      }),
    ),
    ...listChanges,
    account,
  });
  const userParameters = closed({
    platform,
    username: Type.String({ description: "Platform username", minLength: 1 }),
  });
  const authenticatedUserParameters = closed({ platform, account });
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
  const threadStateParameters = closed({ platform, owner, repo, number, threadId, account });
  const replyThreadParameters = closed({
    platform,
    owner,
    repo,
    number,
    threadId,
    body: Type.String({ description: "Reply body", minLength: 1 }),
    account,
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

  const localInspectParameters = closed({
    cwd: Type.String({ description: "Local checkout directory", minLength: 1 }),
    paths: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description:
          "Git pathspecs relative to the repository root; omitted means all paths. Wildcards and :(literal) are supported.",
        maxItems: 100,
      }),
    ),
    filesOffset: Type.Optional(
      Type.Integer({
        description:
          "Zero-based inventory offset; use nextFilesOffset to continue with the same paths",
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      }),
    ),
    filesLimit: Type.Optional(
      Type.Integer({
        description:
          "Maximum tracked paths per page, default 1000; names also have a 64 KiB page budget",
        minimum: 1,
        maximum: 1000,
      }),
    ),
    historyLimit: Type.Optional(
      Type.Integer({
        description: "Maximum HEAD commits to return, including message bodies; defaults to 3",
        minimum: 1,
        maximum: 100,
      }),
    ),
  });

  return {
    localInspectParameters,
    localMergeParameters,
    listRepositoriesParameters,
    repositoryParameters,
    repositoryContentsParameters,
    listContributionTemplatesParameters,
    contributionTemplateParameters,
    codeSearchParameters,
    commitParameters,
    commitPatchParameters,
    listCommitsParameters,
    commitSearchParameters,
    globalPullRequestSearchParameters,
    listCiRunsParameters,
    listCiJobsParameters,
    ciJobLogParameters,
    listReleasesParameters,
    releaseParameters,
    createReleaseParameters,
    updateReleaseParameters,
    listRepositoryItemsParameters,
    searchRepositoryItemsParameters,
    repositoryItemParameters,
    pullRequestParameters,
    listCommentsParameters,
    listPullRequestFilesParameters,
    listPullRequestChecksParameters,
    listPullRequestReviewsParameters,
    pullRequestReviewParameters,
    commentParameters,
    createCommentParameters,
    createIssueParameters,
    updateIssueParameters,
    createPullRequestParameters,
    updatePullRequestParameters,
    userParameters,
    authenticatedUserParameters,
    listThreadsParameters,
    threadParameters,
    threadStateParameters,
    replyThreadParameters,
  };
}

/** Parameter schemas for the forges tool surface, built with the package TypeBox. */
export type ForgesToolSchemas = ReturnType<typeof forgesToolSchemas>;

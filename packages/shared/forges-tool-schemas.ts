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
  const platform = Type.Unsafe<ForgesPlatform>({
    type: "string",
    enum: ["github", "gitlab", "gitea"],
    description: "Git hosting platform",
  });
  const owner = Type.String({ description: "Repository owner or organization", minLength: 1 });
  const repo = Type.String({ description: "Repository name", minLength: 1 });
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

  /** A closed object rejects a stray `per_page` instead of quietly shrinking the page. */
  function closed<T extends TProperties>(properties: T): TObject<T> {
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
    listContributionTemplatesParameters,
    contributionTemplateParameters,
    codeSearchParameters,
    commitParameters,
    commitPatchParameters,
    listCommitsParameters,
    commitSearchParameters,
    listCiRunsParameters,
    listReleasesParameters,
    releaseParameters,
    createReleaseParameters,
    updateReleaseParameters,
    listRepositoryItemsParameters,
    searchRepositoryItemsParameters,
    repositoryItemParameters,
    listCommentsParameters,
    listPullRequestFilesParameters,
    listPullRequestChecksParameters,
    listPullRequestReviewsParameters,
    pullRequestReviewParameters,
    commentParameters,
    createIssueParameters,
    createPullRequestParameters,
    userParameters,
    authenticatedUserParameters,
    listThreadsParameters,
    threadParameters,
    replyThreadParameters,
  };
}

/** Parameter schemas for the forges tool surface, built with the package TypeBox. */
export type ForgesToolSchemas = ReturnType<typeof forgesToolSchemas>;

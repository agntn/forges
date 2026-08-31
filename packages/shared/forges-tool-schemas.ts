import { Type } from "typebox";

/**
 * The platforms every tool surface accepts, re-exported from `src/tool-operations.ts`.
 *
 * The union is declared here rather than imported from `src/`, because this file
 * ships to npm and `src/` does not: a type import pointing back into the source
 * tree would dangle in the published package.
 */
export type ForgesPlatform = "github" | "gitlab" | "gitea";

/**
 * Parameter schemas for the forges tool surface, built with the package TypeBox.
 *
 * Pi and the MCP server share these schemas. The OMP extension builds its own
 * copies from `ExtensionAPI.typebox`, because OMP validates tool parameters with
 * its host TypeBox build rather than this one.
 *
 * No schema carries a token or a base URL: credentials come from the local
 * detection chain and endpoints from the `FORGES_*_BASE_URL` variables, so a
 * model can never point an operation at a host of its choosing.
 */
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
const branch = Type.Optional(Type.String({ description: "Filter by branch", minLength: 1 }));
const ref = Type.Optional(
  Type.String({ description: "Branch, tag, or commit reference", minLength: 1 }),
);
const path = Type.Optional(Type.String({ description: "Filter by repository path", minLength: 1 }));
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

export const listRepositoriesParameters = Type.Object({ platform, owner, page, perPage });
export const repositoryParameters = Type.Object({ platform, owner, repo });
export const listContributionTemplatesParameters = Type.Object({
  platform,
  owner,
  repo,
  kind: contributionTemplateKind,
  page,
  perPage,
});
export const contributionTemplateParameters = Type.Object({
  platform,
  owner,
  repo,
  kind: contributionTemplateKind,
  key: contributionTemplateKey,
});
export const codeSearchParameters = Type.Object({
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
export const commitParameters = Type.Object({ platform, owner, repo, sha });
export const listCommitsParameters = Type.Object({
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
export const listCiRunsParameters = Type.Object({ platform, owner, repo, branch, page, perPage });
export const listRepositoryItemsParameters = Type.Object({
  platform,
  owner,
  repo,
  page,
  perPage,
  state,
});
export const searchRepositoryItemsParameters = Type.Object({
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
export const repositoryItemParameters = Type.Object({ platform, owner, repo, number });
export const listCommentsParameters = Type.Object({ platform, owner, repo, number, page, perPage });
export const listPullRequestFilesParameters = listCommentsParameters;
export const listPullRequestChecksParameters = listCommentsParameters;
export const commentParameters = Type.Object({ platform, owner, repo, number, commentId });
export const createIssueParameters = Type.Object({
  platform,
  owner,
  repo,
  title: Type.String({ description: "Issue title", minLength: 1 }),
  body: Type.String({ description: "Issue body" }),
  labels: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  assignees,
});
export const createPullRequestParameters = Type.Object({
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
export const userParameters = Type.Object({
  platform,
  username: Type.String({ description: "Platform username", minLength: 1 }),
});
export const authenticatedUserParameters = Type.Object({ platform });
export const listThreadsParameters = Type.Object({
  platform,
  owner,
  repo,
  number,
  page,
  perPage,
  state: threadState,
});
export const threadParameters = Type.Object({ platform, owner, repo, number, threadId });
export const replyThreadParameters = Type.Object({
  platform,
  owner,
  repo,
  number,
  threadId,
  body: Type.String({ description: "Reply body", minLength: 1 }),
});

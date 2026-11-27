import { Type, type TObject, type TProperties, type TSchema } from "@agntn/tools";

import type { ForgesToolName } from "../extensions/shared/tool-effects.ts";

/** `details` schemas. A write keeps the envelope, so a shape slip can't fake a failure. */
export function forgesToolOutputs(): Readonly<Record<ForgesToolName, TObject>> {
  const login = Type.Object({ login: Type.String() });
  const issueNumber = Type.Union([Type.Integer(), Type.String()]);
  const issue = {
    id: Type.String(),
    number: issueNumber,
    title: Type.String(),
    state: Type.Enum(["open", "closed"]),
    labels: Type.Array(Type.String()),
    author: login,
    assignees: Type.Array(login),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    url: Type.String(),
    type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    fields: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Union([Type.String(), Type.Number(), Type.Array(Type.String())]),
      ),
    ),
  };
  const pullRequestHit = {
    ...issue,
    number: Type.Integer(),
    merged: Type.Boolean(),
    draft: Type.Boolean(),
  };
  const pullRequest = {
    ...pullRequestHit,
    sourceBranch: Type.String(),
    targetBranch: Type.String(),
    mergeCommitSha: Type.String(),
    mergedAt: Type.Union([Type.String(), Type.Null()]),
    mergedBy: Type.Union([login, Type.Null()]),
    headSha: Type.String(),
    mergeable: Type.Union([Type.Boolean(), Type.Null()]),
    mergeStatus: Type.String(),
    closingIssues: Type.Optional(
      Type.Union([
        Type.Array(
          Type.Object({
            number: Type.Integer(),
            title: Type.String(),
            state: Type.Enum(["open", "closed"]),
            url: Type.String(),
          }),
        ),
        Type.Null(),
      ]),
    ),
    assignmentError: Type.Optional(Type.String()),
  };
  const bodySlice = {
    body: Type.String(),
    offset: Type.Integer(),
    nextOffset: Type.Union([Type.Integer(), Type.Null()]),
    truncated: Type.Boolean(),
    length: Type.Integer(),
    bodyHash: Type.String(),
  };
  const hitBody = {
    body: Type.Optional(Type.String()),
    bodyTruncated: Type.Optional(Type.Boolean()),
  };
  const repository = { repository: Type.String() };
  const resultLimit = { resultLimit: Type.Union([Type.Integer(), Type.Null()]) };
  const thread = Type.Object({
    id: Type.String(),
    isResolved: Type.Boolean(),
    isOutdated: Type.Boolean(),
    path: Type.String(),
    line: Type.Union([Type.Integer(), Type.Null()]),
    startLine: Type.Union([Type.Integer(), Type.Null()]),
    comments: Type.Array(
      Type.Object({
        id: Type.String(),
        body: Type.String(),
        author: login,
        url: Type.String(),
        createdAt: Type.String(),
      }),
    ),
  });

  const page = (item: TSchema, more: TProperties = {}) =>
    Type.Object({
      items: Type.Array(item),
      totalCount: Type.Optional(Type.Number()),
      nextCursor: Type.Optional(Type.String()),
      ...more,
    });
  const searchPage = (item: TSchema, more: TProperties = {}) =>
    page(item, { incomplete: Type.Boolean(), ...more });
  /** One key, or a list answered in order with each key's result or error. */
  const oneOrBatch = (item: TSchema, key: Readonly<Record<string, TSchema>>) =>
    Type.Union([
      item,
      Type.Array(
        Type.Union([
          Type.Object({ ...key, result: item }),
          Type.Object({ ...key, error: Type.String() }),
        ]),
      ),
    ]);
  const answer = (result: TSchema) =>
    Type.Object({
      platform: Type.String(),
      result,
      note: Type.Optional(Type.String()),
    });

  const anything = answer(Type.Unknown());
  const anyPage = answer(page(Type.Unknown()));
  const anySearch = answer(searchPage(Type.Unknown()));

  return {
    forges_repos_list: anyPage,
    forges_repos_get: anything,
    forges_repos_contents: anything,
    forges_repos_tags: anyPage,
    forges_repos_tree: anyPage,
    forges_contribution_templates_list: anyPage,
    forges_contribution_templates_get: anything,
    forges_code_search: anySearch,
    forges_ci_runs_list: anyPage,
    forges_ci_jobs_list: anyPage,
    forges_ci_jobs_log: anything,
    forges_commits_search: anySearch,
    forges_commits_list: anyPage,
    forges_commits_compare: anyPage,
    forges_commits_get: anything,
    forges_commits_checks: anyPage,
    forges_commits_patch: anything,
    forges_releases_list: anyPage,
    forges_releases_get: anything,
    forges_releases_create: anything,
    forges_releases_update: anything,
    forges_issues_list: answer(page(Type.Object(issue))),
    forges_issues_search_global: answer(
      searchPage(Type.Object({ ...issue, ...hitBody, ...repository }), resultLimit),
    ),
    forges_issues_search: answer(searchPage(Type.Object({ ...issue, ...hitBody }))),
    forges_issues_get: answer(
      oneOrBatch(Type.Object({ ...issue, ...bodySlice }), { number: issueNumber }),
    ),
    forges_issues_comments: anyPage,
    forges_issues_comments_get: anything,
    forges_issues_reactions: anyPage,
    forges_issues_events: anyPage,
    forges_issues_comments_create: anything,
    forges_issues_comments_update: anything,
    forges_issues_comments_delete: anything,
    forges_issues_fields: anything,
    forges_issues_create: anything,
    forges_issues_update: anything,
    forges_issues_sub_issues: answer(page(Type.Object({ ...issue, ...repository }))),
    forges_issues_sub_issues_add: anything,
    forges_issues_sub_issues_remove: anything,
    forges_pull_requests_list: answer(page(Type.Object(pullRequest))),
    forges_pull_requests_search_global: answer(
      searchPage(Type.Object({ ...pullRequestHit, ...hitBody, ...repository }), resultLimit),
    ),
    forges_pull_requests_search: answer(searchPage(Type.Object({ ...pullRequestHit, ...hitBody }))),
    forges_pull_requests_get: answer(
      oneOrBatch(Type.Object({ ...pullRequest, ...bodySlice }), { number: Type.Integer() }),
    ),
    forges_pull_requests_files: anyPage,
    forges_pull_requests_checks: anyPage,
    forges_pull_requests_reviews: anyPage,
    forges_pull_requests_reviews_get: anything,
    forges_pull_requests_comments: anyPage,
    forges_pull_requests_comments_get: anything,
    forges_pull_requests_reactions: anyPage,
    forges_pull_requests_events: anyPage,
    forges_pull_requests_comments_create: anything,
    forges_pull_requests_comments_update: anything,
    forges_pull_requests_comments_delete: anything,
    forges_pull_requests_create: anything,
    forges_pull_requests_update: anything,
    forges_pull_requests_merge: anything,
    forges_users_get: anything,
    forges_users_authenticated: anything,
    forges_auth_reload: anything,
    forges_threads_list: answer(page(thread)),
    forges_threads_get: answer(oneOrBatch(thread, { threadId: Type.String() })),
    forges_threads_reply: anything,
    forges_threads_comments_update: anything,
    forges_threads_comments_delete: anything,
    forges_threads_resolve: anything,
    forges_threads_unresolve: anything,
    forges_local_inspect: anything,
    forges_local_merge_verify: anything,
  };
}

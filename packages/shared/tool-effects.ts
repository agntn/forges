/** Effects describe operations, not permission to execute them. */
export type ToolEffect =
  | "hostedRead"
  | "localRead"
  | "remoteCreate"
  | "remoteUpdate"
  | "remoteState"
  | "credentialReload";

/** Every agent tool declares its effect here, including local operations. */
export const toolEffects = {
  forges_repos_list: "hostedRead",
  forges_repos_get: "hostedRead",
  forges_repos_contents: "hostedRead",
  forges_contribution_templates_list: "hostedRead",
  forges_contribution_templates_get: "hostedRead",
  forges_code_search: "hostedRead",
  forges_ci_runs_list: "hostedRead",
  forges_ci_jobs_list: "hostedRead",
  forges_ci_jobs_log: "hostedRead",
  forges_commits_search: "hostedRead",
  forges_commits_list: "hostedRead",
  forges_commits_get: "hostedRead",
  forges_commits_patch: "hostedRead",
  forges_releases_list: "hostedRead",
  forges_releases_get: "hostedRead",
  forges_releases_create: "remoteCreate",
  forges_releases_update: "remoteUpdate",
  forges_issues_list: "hostedRead",
  forges_issues_search: "hostedRead",
  forges_issues_get: "hostedRead",
  forges_issues_comments: "hostedRead",
  forges_issues_comments_get: "hostedRead",
  forges_issues_comments_create: "remoteCreate",
  forges_issues_create: "remoteCreate",
  forges_pull_requests_list: "hostedRead",
  forges_pull_requests_search: "hostedRead",
  forges_pull_requests_search_global: "hostedRead",
  forges_pull_requests_get: "hostedRead",
  forges_pull_requests_files: "hostedRead",
  forges_pull_requests_checks: "hostedRead",
  forges_pull_requests_reviews: "hostedRead",
  forges_pull_requests_reviews_get: "hostedRead",
  forges_pull_requests_comments: "hostedRead",
  forges_pull_requests_comments_get: "hostedRead",
  forges_pull_requests_comments_create: "remoteCreate",
  forges_pull_requests_create: "remoteCreate",
  forges_pull_requests_update: "remoteUpdate",
  forges_users_get: "hostedRead",
  forges_users_authenticated: "hostedRead",
  forges_auth_reload: "credentialReload",
  forges_threads_list: "hostedRead",
  forges_threads_get: "hostedRead",
  forges_threads_reply: "remoteCreate",
  forges_threads_resolve: "remoteState",
  forges_threads_unresolve: "remoteState",
  forges_local_inspect: "localRead",
  forges_local_merge_verify: "localRead",
} as const satisfies Record<string, ToolEffect>;

/** Names shared by the agent adapters. */
export type ForgesToolName = keyof typeof toolEffects;

/** Unknown tools must not silently acquire read privileges or read labels. */
export function getToolEffect(name: string): ToolEffect {
  if (!isToolName(name)) throw new Error(`Missing tool effect: ${name}`);
  return toolEffects[name];
}

function isToolName(name: string): name is ForgesToolName {
  return Object.hasOwn(toolEffects, name);
}

/** OMP approval categories and TUI labels share this projection, not enforcement. */
export function toolApproval(name: string): "read" | "write" {
  const effect = getToolEffect(name);
  return effect === "hostedRead" || effect === "localRead" ? "read" : "write";
}

/** Reload also verifies the account remotely; only local Git reads stay offline. */
export function toolAnnotations(name: ForgesToolName) {
  const effect = getToolEffect(name);
  return {
    readOnlyHint: effect === "hostedRead" || effect === "localRead",
    destructiveHint: effect === "remoteUpdate",
    idempotentHint: effect !== "remoteCreate" && effect !== "credentialReload",
    openWorldHint: effect !== "localRead",
  };
}

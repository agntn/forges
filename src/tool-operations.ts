import { createProvider, resolveToken, type AuthResult } from "./index.ts";
import type {
  InspectLocalOptions,
  LocalInspection,
  LocalMergeVerification,
  VerifyLocalMergeOptions,
} from "./local.ts";
import { assertAssignees } from "./assignees.ts";
import { assertIssueUpdate, assertPullRequestUpdate } from "./update-input.ts";
import { waitForChecks, type WaitedCheckPage } from "./check-wait.ts";
import { FetchError } from "ofetch";
import { AuthenticationError, ForgesError } from "./errors.ts";
import type { ForgesPlatform } from "../packages/shared/forges-tool-schemas.ts";
import type { Provider } from "./provider.ts";
import type {
  CiJob,
  CiJobLog,
  CiJobLogOptions,
  CiRun,
  CodeSearchItem,
  CodeSearchOptions,
  Comment,
  Commit,
  CommitPatch,
  CommitPatchOptions,
  ContributionTemplate,
  ContributionTemplateKind,
  ContributionTemplateSummary,
  CommitSummary,
  CommitSearchItem,
  CommitSearchOptions,
  CommitSearchResult,
  CreateCommentInput,
  CreateIssueInput,
  CreatePullRequestInput,
  CreateReleaseInput,
  Issue,
  IssueState,
  ListCiRunsOptions,
  ListCommentOptions,
  ListCommitOptions,
  ListContributionTemplatesOptions,
  ListOptions,
  ListPullRequestChecksOptions,
  ListPullRequestFilesOptions,
  ListPullRequestReviewsOptions,
  ListReleasesOptions,
  ListThreadOptions,
  PageResult,
  PullRequest,
  PullRequestCheck,
  PullRequestFile,
  PullRequestReview,
  PullRequestSearchItem,
  GlobalPullRequestSearchOptions,
  GlobalPullRequestSearchItem,
  Release,
  ReplyThreadInput,
  Repository,
  RepositoryContents,
  RepositoryContentsOptions,
  SearchPageResult,
  Thread,
  ThreadComment,
  ThreadState,
  UpdateIssueInput,
  UpdatePullRequestInput,
  UpdateReleaseInput,
  User,
} from "./types.ts";

export type { ForgesPlatform };

const baseUrlEnvByPlatform: Record<ForgesPlatform, string> = {
  github: "FORGES_GITHUB_BASE_URL",
  gitlab: "FORGES_GITLAB_BASE_URL",
  gitea: "FORGES_GITEA_BASE_URL",
};

/**
 * Authenticated providers stay pinned so a confirmed account cannot drift before a write.
 *
 * The maps hold the creation promise rather than the instance: provider modules
 * load on demand, and two calls racing on a cold platform must share one
 * credential resolution instead of pinning whichever finished last.
 */
const pinnedProviders = new Map<string, Promise<Provider>>();
/** Anonymous providers are isolated because no write may reuse one. */
const anonymousReadProviders = new Map<string, Promise<Provider>>();
const credentialOperationTails = new Map<ForgesPlatform, Promise<void>>();

/** Keep reloads and hosted writes ordered around one platform's pinned identity. */
async function withCredentialOperation<T>(
  platform: ForgesPlatform,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = credentialOperationTails.get(platform) ?? Promise.resolve();
  const next = Promise.withResolvers<void>();
  const tail = previous.then(() => next.promise);
  credentialOperationTails.set(platform, tail);
  await previous;

  try {
    return await operation();
  } finally {
    next.resolve();
    if (credentialOperationTails.get(platform) === tail) credentialOperationTails.delete(platform);
  }
}

/** An account key extends its platform key, so a platform reset drops it too. */
function providerKey(platform: ForgesPlatform, account?: string): string {
  const baseURL = process.env[baseUrlEnvByPlatform[platform]];
  const key = baseURL === undefined ? platform : `${platform} ${baseURL}`;
  return account === undefined ? key : `${key} @${account.toLowerCase()}`;
}

function configuredToken(platform: ForgesPlatform): string {
  const baseURL = process.env[baseUrlEnvByPlatform[platform]];
  return resolveToken(platform, { baseURL })?.token ?? "";
}

async function createConfiguredProvider(
  platform: ForgesPlatform,
  token: string,
): Promise<Provider> {
  const baseURL = process.env[baseUrlEnvByPlatform[platform]];
  return createProvider(platform, baseURL === undefined ? { token } : { baseURL, token });
}

/** Start one provider load under a key and forget it again if the load fails. */
function trackProvider(
  providers: Map<string, Promise<Provider>>,
  key: string,
  load: () => Promise<Provider>,
): Promise<Provider> {
  const provider = load();
  providers.set(key, provider);
  provider.catch(() => {
    if (providers.get(key) === provider) providers.delete(key);
  });
  return provider;
}

function credentialSetupHint(platform: ForgesPlatform): string {
  switch (platform) {
    case "github":
      return "Set GITHUB_TOKEN or log in with `gh auth login`.";
    case "gitlab":
      return "Set GITLAB_TOKEN or log in with `glab auth login`.";
    case "gitea":
      return "Set GITEA_TOKEN or log in with `tea login add`.";
  }
}

async function authenticatedProvider(
  platform: ForgesPlatform,
  account?: string,
): Promise<Provider> {
  if (account !== undefined) return accountProvider(platform, account);

  const key = providerKey(platform);
  const pinned = pinnedProviders.get(key);
  if (pinned) return pinned;

  const token = configuredToken(platform);
  if (token === "") {
    throw new AuthenticationError(
      `No auth token found for ${platform}. ${credentialSetupHint(platform)}`,
      platform,
    );
  }

  return trackProvider(pinnedProviders, key, () => createConfiguredProvider(platform, token));
}

/**
 * Pin a provider to one named account, next to the platform's default credential.
 *
 * Only `gh` can hand out the token of a login that is not the active one. The
 * token then has to prove it belongs to that login before anything is written:
 * a `GH_TOKEN` in the environment still wins the lookup, and a write signed by
 * the wrong account would look like a success.
 */
function accountProvider(platform: ForgesPlatform, account: string): Promise<Provider> {
  if (platform !== "github") {
    throw new ForgesError(
      `Choosing an account is supported only on github; omit account to write as the ${platform} credential.`,
      501,
      platform,
    );
  }

  const key = providerKey(platform, account);
  const pinned = pinnedProviders.get(key);
  if (pinned) return pinned;

  const baseURL = process.env[baseUrlEnvByPlatform[platform]];
  const credential = resolveToken(platform, { baseURL, account });
  if (credential === null || credential.token === "") {
    throw new AuthenticationError(
      `No auth token found for ${platform} account "${account}". Log in with \`gh auth login\` until \`gh auth status\` lists it.`,
      platform,
    );
  }

  return trackProvider(pinnedProviders, key, () =>
    verifiedAccountProvider(platform, account, credential),
  );
}

async function verifiedAccountProvider(
  platform: ForgesPlatform,
  account: string,
  credential: AuthResult,
): Promise<Provider> {
  const provider = await createConfiguredProvider(platform, credential.token);
  const { login } = await provider.users.authenticated();
  if (login.toLowerCase() === account.toLowerCase()) return provider;

  const hint =
    credential.source === "env"
      ? "GH_TOKEN or GITHUB_TOKEN is set and takes precedence; unset it to use the gh login."
      : "Check `gh auth status`.";
  throw new AuthenticationError(
    `Refusing to act as "${account}": the ${platform} token found for it belongs to "${login}". ${hint}`,
    platform,
  );
}

function readProvider(platform: ForgesPlatform): Promise<Provider> {
  const key = providerKey(platform);
  const authenticated = pinnedProviders.get(key);
  if (authenticated) return authenticated;

  const token = configuredToken(platform);
  if (token !== "") {
    anonymousReadProviders.delete(key);
    return trackProvider(pinnedProviders, key, () => createConfiguredProvider(platform, token));
  }

  return (
    anonymousReadProviders.get(key) ??
    trackProvider(anonymousReadProviders, key, async () =>
      explainAnonymousRefusals(await createConfiguredProvider(platform, token), platform),
    )
  );
}

const ANONYMOUS_REFUSALS = new Set([401, 403, 404, 429]);
/** Refusals already explained, since callers sharing one in-flight load get the same error. */
const explainedRefusals = new WeakSet<ForgesError>();

/**
 * Make a refusal of a tokenless read say that no token was sent.
 *
 * A private repository answers 404 to such a request, exactly like one that does
 * not exist, so without this the agent concludes the repository is missing. Only
 * refusals the server sent are touched: a provider's own 404, such as a template
 * key missing from its list, means the item really is absent.
 */
function explainAnonymousRefusals(provider: Provider, platform: ForgesPlatform): Provider {
  const explain = (error: unknown): unknown => {
    if (
      !(error instanceof ForgesError) ||
      explainedRefusals.has(error) ||
      !(error.originalError instanceof FetchError) ||
      error.status === undefined ||
      !ANONYMOUS_REFUSALS.has(error.status)
    ) {
      return error;
    }

    const reason =
      error.status === 404
        ? `The request carried no token, and ${platform} answers 404 for a private repository as well as a missing one.`
        : error.status === 429
          ? "The request carried no token, and requests without one get a far lower rate limit."
          : "The request carried no token.";
    error.message = `${error.message.trimEnd().replace(/\.?$/, ".")} ${reason} ${credentialSetupHint(platform)} Then retry.`;
    explainedRefusals.add(error);
    return error;
  };

  return new Proxy(provider, {
    get(target, property, receiver) {
      const resource: unknown = Reflect.get(target, property, receiver);
      if (typeof resource !== "object" || resource === null) return resource;
      return new Proxy(resource, {
        get(object, name, objectReceiver) {
          const method: unknown = Reflect.get(object, name, objectReceiver);
          if (typeof method !== "function") return method;
          return (...args: unknown[]) =>
            Promise.resolve()
              .then(() => method.apply(object, args))
              .catch((error: unknown) => {
                throw explain(error);
              });
        },
      });
    },
  });
}

/** Drop pinned providers so the next matching call resolves its local credential again. */
export function resetPinnedProviders(platform?: ForgesPlatform): void {
  if (platform === undefined) {
    pinnedProviders.clear();
    anonymousReadProviders.clear();
    return;
  }

  for (const providers of [pinnedProviders, anonymousReadProviders]) {
    for (const key of providers.keys()) {
      if (key === platform || key.startsWith(`${platform} `)) providers.delete(key);
    }
  }
}

export interface PlatformParams {
  /** Omitted means github, the platform an agent asks for far more often than it varies. */
  platform?: ForgesPlatform;
}

export interface AccountParams {
  /** GitHub login to act as; omitted means the platform's pinned credential. */
  account?: string;
}

export interface OwnerParams extends PlatformParams {
  owner?: string;
}

export interface RepositoryParams extends OwnerParams {
  /** A bare repository name, or `owner/name` while `owner` is omitted. */
  repo: string;
}

/** The target an operation works on once the loose arguments are resolved. */
export interface RepositoryTarget {
  platform: ForgesPlatform;
  owner: string;
  repo: string;
}

const defaultPlatform: ForgesPlatform = "github";

function targetError(message: string, platform: ForgesPlatform): ForgesError {
  return new ForgesError(message, undefined, platform);
}

/**
 * Split an `owner/name` slug written into `repo`.
 *
 * Every forge, its web UI and its CLI write a repository that way, so a caller
 * holding the slug tends to pass it whole. An explicit `owner` alongside a
 * slashed `repo` is contradictory rather than redundant, and is rejected instead
 * of one of the two being picked silently.
 */
function splitRepository(
  repo: string,
  owner: string | undefined,
  platform: ForgesPlatform,
): { owner: string | undefined; repo: string } {
  if (!repo.includes("/")) return { owner, repo };

  if (owner !== undefined) {
    throw targetError(
      `Ambiguous repository: owner "${owner}" was passed with repo "${repo}". Pass either owner and a bare repo name, or repo alone as "owner/name".`,
      platform,
    );
  }

  const segments = repo.split("/");
  const [slugOwner, slugRepo] = segments;
  if (segments.length !== 2 || !slugOwner || !slugRepo) {
    throw targetError(
      `Invalid repository "${repo}": pass a bare name, or "owner/name" with exactly one slash.`,
      platform,
    );
  }

  return { owner: slugOwner, repo: slugRepo };
}

/** Resolve the platform of an operation that names no repository. */
function platformTarget<P extends PlatformParams>(params: P): P & { platform: ForgesPlatform } {
  return { ...params, platform: params.platform ?? defaultPlatform };
}

/** Resolve an operation scoped to an account rather than to one repository. */
function ownerTarget<P extends OwnerParams>(
  params: P,
): P & { platform: ForgesPlatform; owner: string } {
  const platform = params.platform ?? defaultPlatform;
  const { owner } = params;
  if (owner === undefined || owner === "") {
    throw targetError("Missing owner: pass the user or organization to read.", platform);
  }
  return { ...params, platform, owner };
}

/** Resolve one repository, accepting the owner either on its own field or inside `repo`. */
export function repositoryTarget<P extends RepositoryParams>(params: P): P & RepositoryTarget {
  const platform = params.platform ?? defaultPlatform;
  const { owner, repo } = splitRepository(params.repo, params.owner, platform);
  if (owner === undefined || owner === "") {
    throw targetError(
      `Missing owner for repository "${repo}": pass owner, or write repo as "owner/${repo}".`,
      platform,
    );
  }
  return { ...params, platform, owner, repo };
}

/** Resolve a search, where an absent owner means the whole platform rather than a mistake. */
function searchTarget<P extends PlatformParams & { owner?: string; repo?: string }>(
  params: P,
): P & { platform: ForgesPlatform } {
  const platform = params.platform ?? defaultPlatform;
  if (params.repo === undefined) return { ...params, platform };
  const { owner, repo } = splitRepository(params.repo, params.owner, platform);
  return { ...params, platform, owner, repo };
}

export interface ListRepositoriesParams extends OwnerParams {
  page?: number;
  perPage?: number;
}

export type GetRepositoryParams = RepositoryParams;

export interface ListContributionTemplatesParams extends RepositoryParams {
  readonly kind: ContributionTemplateKind;
  readonly page?: number;
  readonly perPage?: number;
}

export interface GetContributionTemplateParams extends RepositoryParams {
  readonly kind: ContributionTemplateKind;
  readonly key: string;
}

export interface SearchPullRequestsGlobalParams
  extends PlatformParams, GlobalPullRequestSearchOptions {
  query: string;
}

export interface SearchCommitsParams extends PlatformParams, CommitSearchOptions {
  query: string;
}

export interface SearchCodeParams extends PlatformParams, CodeSearchOptions {
  query: string;
}

export interface GetCommitParams extends RepositoryParams {
  sha: string;
}

export type ReadRepositoryContentsParams = RepositoryParams &
  RepositoryContentsOptions & { path: string };

export type ReadCommitPatchParams = RepositoryParams & CommitPatchOptions & { sha: string };

export type ListCommitsParams = RepositoryParams & ListCommitOptions;

export interface ListCiRunsParams extends RepositoryParams {
  branch?: string;
  page?: number;
  perPage?: number;
}

export interface ListCiJobsParams extends RepositoryParams {
  runId: string;
  page?: number;
  perPage?: number;
}

export type ReadCiJobLogParams = RepositoryParams & CiJobLogOptions & { jobId: string };

export interface ListReleasesParams extends RepositoryParams {
  page?: number;
  perPage?: number;
}

export interface GetReleaseParams extends RepositoryParams {
  tag: string;
}

export type CreateReleaseParams = RepositoryParams & AccountParams & CreateReleaseInput;

export type UpdateReleaseParams = GetReleaseParams & AccountParams & UpdateReleaseInput;

export interface ListRepositoryItemsParams extends RepositoryParams {
  page?: number;
  perPage?: number;
  state?: IssueState | "all";
}

export interface SearchRepositoryItemsParams extends ListRepositoryItemsParams {
  query: string;
}

export type SearchRepositoryIssuesParams = SearchRepositoryItemsParams;
export type SearchRepositoryPullRequestsParams = SearchRepositoryItemsParams;

export interface GetRepositoryItemParams extends RepositoryParams {
  number: number;
}

export type CreateIssueParams = RepositoryParams & AccountParams & CreateIssueInput;

export type CreatePullRequestParams = RepositoryParams & AccountParams & CreatePullRequestInput;

export type UpdateIssueParams = GetRepositoryItemParams & AccountParams & UpdateIssueInput;

export type UpdatePullRequestParams = GetRepositoryItemParams &
  AccountParams &
  UpdatePullRequestInput;

export interface ListCommentsParams extends RepositoryParams {
  number: number;
  page?: number;
  perPage?: number;
}

export type ListPullRequestFilesParams = ListCommentsParams;
export type ListPullRequestReviewsParams = ListCommentsParams;

export interface ListPullRequestChecksParams extends ListCommentsParams {
  /** Seconds to wait for every check to conclude; absent reads the current state once. */
  waitSeconds?: number;
}

export interface GetPullRequestParams extends GetRepositoryItemParams {
  /** Also list the issues the pull request closes on merge. */
  closingIssues?: boolean;
}

export interface GetPullRequestReviewParams extends GetRepositoryItemParams {
  reviewId: string;
}

export interface GetCommentParams extends RepositoryParams {
  number: number;
  commentId: string;
}

export type CreateCommentParams = GetRepositoryItemParams & AccountParams & CreateCommentInput;

export interface GetUserParams extends PlatformParams {
  username: string;
}

export interface ForgesToolDetails<T> {
  platform: ForgesPlatform | "local";
  result: T;
}

export interface ForgesToolResult<T> {
  content: [{ type: "text"; text: string }];
  details: ForgesToolDetails<T>;
}

function result<T>(
  platform: ForgesPlatform | "local",
  value: T,
  note?: string,
): ForgesToolResult<T> {
  const details = { platform, result: value };
  const modelDetails = note ? { ...details, note } : details;
  return {
    content: [{ type: "text", text: JSON.stringify(modelDetails) }],
    details,
  };
}

function assignmentNote(
  requested: string[] | undefined,
  actual: Array<{ login: string }>,
): string | undefined {
  if (!requested?.length) return undefined;
  const assigned = new Set(actual.map(({ login }) => login.toLowerCase()));
  const missing = requested.filter((login) => !assigned.has(login.toLowerCase()));
  if (missing.length === 0) return undefined;
  return `Creation succeeded, but requested assignees are missing: ${missing.join(", ")}. Do not retry the create call; the result is the created object.`;
}

/** A platform can accept an assignee change and still not apply it, GitLab Free past one. */
function reassignmentNote(
  params: Pick<UpdateIssueInput, "addAssignees" | "removeAssignees">,
  actual: Array<{ login: string }>,
): string | undefined {
  const assigned = new Set(actual.map(({ login }) => login.toLowerCase()));
  const missing = (params.addAssignees ?? []).filter((login) => !assigned.has(login.toLowerCase()));
  const kept = (params.removeAssignees ?? []).filter((login) => assigned.has(login.toLowerCase()));
  const problems = [
    ...(missing.length > 0 ? [`not assigned: ${missing.join(", ")}`] : []),
    ...(kept.length > 0 ? [`still assigned: ${kept.join(", ")}`] : []),
  ];
  if (problems.length === 0) return undefined;
  return `Update succeeded, but the assignees did not change as asked (${problems.join("; ")}). The result shows who is assigned now.`;
}

function summarizeIssuePage<T extends Issue>(
  page: SearchPageResult<T>,
): SearchPageResult<Omit<T, "body">>;
function summarizeIssuePage<T extends Issue>(page: PageResult<T>): PageResult<Omit<T, "body">>;
function summarizeIssuePage<T extends Issue>(page: PageResult<T>): PageResult<Omit<T, "body">> {
  return {
    ...page,
    items: page.items.map(({ body: _body, ...summary }) => summary),
  };
}

/** A minified or generated comment can be one very long line, so cap both axes. */
const COMMENT_SUMMARY_MAX_LINES = 12;
const COMMENT_SUMMARY_MAX_CHARS = 4000;

function summarizeCommentBody(body: string): string {
  return body
    .split("\n")
    .slice(0, COMMENT_SUMMARY_MAX_LINES)
    .join("\n")
    .slice(0, COMMENT_SUMMARY_MAX_CHARS);
}

function summarizeCommentPage(page: PageResult<Comment>): PageResult<Comment> {
  return {
    ...page,
    items: page.items.map((comment) => ({
      ...comment,
      body: summarizeCommentBody(comment.body),
    })),
  };
}

function summarizeReviewPage(page: PageResult<PullRequestReview>): PageResult<PullRequestReview> {
  return {
    ...page,
    items: page.items.map((review) => ({
      ...review,
      body: summarizeCommentBody(review.body),
    })),
  };
}

/** A list is for picking commits; forges_commits_get reads one message whole. */
const COMMIT_SUBJECT_MAX_CHARS = 200;

/** A commit row whose message may be cut to its subject line. */
export type CommitListItem<T extends CommitSummary = CommitSummary> = T & {
  messageTruncated?: true;
};

export interface CommitSearchListResult extends CommitSearchResult {
  items: CommitListItem<CommitSearchItem>[];
}

/** Surrounding whitespace, such as the trailing newline Gitea and GitLab often return, is not lost text. */
function summarizeCommit<T extends CommitSummary>(commit: T): CommitListItem<T> {
  const message = commit.message.trim();
  const lineEnd = message.search(/\r?\n/);
  const subject = (lineEnd === -1 ? message : message.slice(0, lineEnd)).slice(
    0,
    COMMIT_SUBJECT_MAX_CHARS,
  );
  if (subject === message) return { ...commit, message };
  return { ...commit, message: subject, messageTruncated: true };
}

function listOptions(params: {
  page?: number;
  perPage?: number;
  state?: IssueState | "all";
}): ListOptions {
  return {
    page: params.page,
    perPage: params.perPage,
    state: params.state,
  };
}

export async function listRepositories(
  args: ListRepositoriesParams,
): Promise<ForgesToolResult<PageResult<Repository>>> {
  const params = ownerTarget(args);
  const provider = await readProvider(params.platform);
  const repositories = await provider.repos.list(params.owner, listOptions(params));
  return result(params.platform, repositories);
}

export async function getRepository(
  args: GetRepositoryParams,
): Promise<ForgesToolResult<Repository>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const repository = await provider.repos.get(params.owner, params.repo);
  return result(params.platform, repository);
}

export async function listContributionTemplates(
  args: ListContributionTemplatesParams,
): Promise<ForgesToolResult<PageResult<ContributionTemplateSummary>>> {
  const params = repositoryTarget(args);
  const options: ListContributionTemplatesOptions = {
    page: params.page,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const templates = await provider.contributionTemplates.list(
    params.owner,
    params.repo,
    params.kind,
    options,
  );
  return result(
    params.platform,
    templates,
    "Template bodies are omitted from list output; use forges_contribution_templates_get with the returned kind and key.",
  );
}

export async function getContributionTemplate(
  args: GetContributionTemplateParams,
): Promise<ForgesToolResult<ContributionTemplate>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const template = await provider.contributionTemplates.get(
    params.owner,
    params.repo,
    params.kind,
    params.key,
  );
  return result(params.platform, template);
}

export async function searchCode(
  args: SearchCodeParams,
): Promise<ForgesToolResult<SearchPageResult<CodeSearchItem>>> {
  const params = searchTarget(args);
  const provider = await readProvider(params.platform);
  const search = await provider.code.search(params.query, {
    owner: params.owner,
    repo: params.repo,
    page: params.page,
    perPage: params.perPage,
  });
  return result(params.platform, search);
}

export async function listCiRuns(
  args: ListCiRunsParams,
): Promise<ForgesToolResult<PageResult<CiRun>>> {
  const params = repositoryTarget(args);
  const options: ListCiRunsOptions = {
    branch: params.branch,
    page: params.page,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const runs = await provider.ciRuns.list(params.owner, params.repo, options);
  return result(params.platform, runs);
}

export async function listCiJobs(
  args: ListCiJobsParams,
): Promise<ForgesToolResult<PageResult<CiJob>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const jobs = await provider.ciRuns.listJobs(params.owner, params.repo, params.runId, {
    page: params.page,
    perPage: params.perPage,
  });
  return result(params.platform, jobs);
}

export async function readCiJobLog(args: ReadCiJobLogParams): Promise<ForgesToolResult<CiJobLog>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const log = await provider.ciRuns.readJobLog(params.owner, params.repo, params.jobId, {
    offset: params.offset,
    maxChars: params.maxChars,
  });
  return result(params.platform, log);
}

export async function searchCommits(
  args: SearchCommitsParams,
): Promise<ForgesToolResult<CommitSearchListResult>> {
  const params = searchTarget(args);
  const provider = await readProvider(params.platform);
  const search = await provider.commits.search(params.query, {
    owner: params.owner,
    repo: params.repo,
    page: params.page,
    perPage: params.perPage,
  });
  return result(
    params.platform,
    { ...search, items: search.items.map(summarizeCommit) },
    "Commit messages are cut to their subject line in search output, and messageTruncated marks each one that lost text; use forges_commits_get with the item's repository and sha to read one in full.",
  );
}

export async function listCommits(
  args: ListCommitsParams,
): Promise<ForgesToolResult<PageResult<CommitListItem>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const commits = await provider.commits.list(params.owner, params.repo, {
    ref: params.ref,
    path: params.path,
    since: params.since,
    until: params.until,
    page: params.page,
    perPage: params.perPage,
  });
  return result(
    params.platform,
    { ...commits, items: commits.items.map(summarizeCommit) },
    "Commit messages are cut to their subject line in list output, and messageTruncated marks each one that lost text; use forges_commits_get to read one in full.",
  );
}

export async function readRepositoryContents(
  args: ReadRepositoryContentsParams,
): Promise<ForgesToolResult<RepositoryContents>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const contents = await provider.repos.readContents(params.owner, params.repo, params.path, {
    ref: params.ref,
    offset: params.offset,
    maxChars: params.maxChars,
  });
  return result(params.platform, contents);
}

export async function getCommit(args: GetCommitParams): Promise<ForgesToolResult<Commit>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const commit = await provider.commits.get(params.owner, params.repo, params.sha);
  return result(params.platform, commit);
}

export async function readCommitPatch(
  args: ReadCommitPatchParams,
): Promise<ForgesToolResult<CommitPatch>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const patch = await provider.commits.readPatch(params.owner, params.repo, params.sha, {
    path: params.path,
    offset: params.offset,
    maxChars: params.maxChars,
  });
  return result(params.platform, patch);
}

function summarizeReleasePage(page: PageResult<Release>): PageResult<Omit<Release, "body">> {
  return {
    ...page,
    items: page.items.map(({ body: _body, ...summary }) => summary),
  };
}

export async function listReleases(
  args: ListReleasesParams,
): Promise<ForgesToolResult<PageResult<Omit<Release, "body">>>> {
  const params = repositoryTarget(args);
  const options: ListReleasesOptions = {
    page: params.page,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const releases = await provider.releases.list(params.owner, params.repo, options);
  return result(
    params.platform,
    summarizeReleasePage(releases),
    "Release notes are omitted from list output; use forges_releases_get with the tag to read one in full.",
  );
}

export async function getRelease(args: GetReleaseParams): Promise<ForgesToolResult<Release>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const release = await provider.releases.get(params.owner, params.repo, params.tag);
  return result(params.platform, release);
}

export async function createRelease(args: CreateReleaseParams): Promise<ForgesToolResult<Release>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const release = await provider.releases.create(params.owner, params.repo, {
      tag: params.tag,
      name: params.name,
      body: params.body,
      ref: params.ref,
      draft: params.draft,
      prerelease: params.prerelease,
    });
    return result(params.platform, release);
  });
}

export async function updateRelease(args: UpdateReleaseParams): Promise<ForgesToolResult<Release>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const release = await provider.releases.update(params.owner, params.repo, params.tag, {
      name: params.name,
      body: params.body,
      draft: params.draft,
      prerelease: params.prerelease,
    });
    return result(params.platform, release);
  });
}

export async function listIssues(
  args: ListRepositoryItemsParams,
): Promise<ForgesToolResult<PageResult<Omit<Issue, "body">>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const issues = await provider.issues.list(params.owner, params.repo, listOptions(params));
  return result(
    params.platform,
    summarizeIssuePage(issues),
    "Issue bodies are omitted from list output; use forges_issues_get to read one body.",
  );
}

export async function searchIssues(
  args: SearchRepositoryIssuesParams,
): Promise<ForgesToolResult<SearchPageResult<Omit<Issue, "body">>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const issues = await provider.issues.search(
    params.owner,
    params.repo,
    params.query,
    listOptions(params),
  );
  return result(
    params.platform,
    summarizeIssuePage(issues),
    "Issue bodies are omitted from search output; use forges_issues_get to read one body.",
  );
}

export async function getIssue(args: GetRepositoryItemParams): Promise<ForgesToolResult<Issue>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const issue = await provider.issues.get(params.owner, params.repo, params.number);
  return result(params.platform, issue);
}

function commentListOptions(params: ListCommentsParams): ListCommentOptions {
  return {
    page: params.page,
    perPage: params.perPage,
  };
}

export async function listIssueComments(
  args: ListCommentsParams,
): Promise<ForgesToolResult<PageResult<Comment>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const comments = await provider.issues.listComments(
    params.owner,
    params.repo,
    params.number,
    commentListOptions(params),
  );
  return result(
    params.platform,
    summarizeCommentPage(comments),
    "Comment bodies are truncated in list output; use forges_issues_comments_get to read one in full.",
  );
}

export async function getIssueComment(args: GetCommentParams): Promise<ForgesToolResult<Comment>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const comment = await provider.issues.getComment(
    params.owner,
    params.repo,
    params.number,
    params.commentId,
  );
  return result(params.platform, comment);
}

export async function createIssueComment(
  args: CreateCommentParams,
): Promise<ForgesToolResult<Comment>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const comment = await provider.issues.createComment(params.owner, params.repo, params.number, {
      body: params.body,
    });
    return result(params.platform, comment);
  });
}

export async function createIssue(args: CreateIssueParams): Promise<ForgesToolResult<Issue>> {
  const params = repositoryTarget(args);
  assertAssignees(params.assignees, params.platform);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const issue = await provider.issues.create(params.owner, params.repo, {
      title: params.title,
      body: params.body,
      labels: params.labels,
      assignees: params.assignees,
    });
    return result(params.platform, issue, assignmentNote(params.assignees, issue.assignees));
  });
}

export async function listPullRequests(
  args: ListRepositoryItemsParams,
): Promise<ForgesToolResult<PageResult<Omit<PullRequest, "body">>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const pullRequests = await provider.pullRequests.list(
    params.owner,
    params.repo,
    listOptions(params),
  );
  return result(
    params.platform,
    summarizeIssuePage(pullRequests),
    "Pull-request bodies are omitted from list output; use forges_pull_requests_get to read one body.",
  );
}

export async function listPullRequestFiles(
  args: ListPullRequestFilesParams,
): Promise<ForgesToolResult<PageResult<PullRequestFile>>> {
  const params = repositoryTarget(args);
  const options: ListPullRequestFilesOptions = {
    page: params.page,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const files = await provider.pullRequests.listFiles(
    params.owner,
    params.repo,
    params.number,
    options,
  );
  return result(params.platform, files);
}

export async function listPullRequestChecks(
  args: ListPullRequestChecksParams,
): Promise<ForgesToolResult<PageResult<PullRequestCheck> | WaitedCheckPage>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const readPage = (page: number) => {
    const options: ListPullRequestChecksOptions = { page, perPage: params.perPage };
    return provider.pullRequests.listChecks(params.owner, params.repo, params.number, options);
  };
  const requestedPage = params.page ?? 1;

  if (params.waitSeconds === undefined) {
    return result(params.platform, await readPage(requestedPage));
  }

  const waited = await waitForChecks(readPage, requestedPage, params.waitSeconds);
  return result(params.platform, waited.page, waited.note);
}

export async function listPullRequestReviews(
  args: ListPullRequestReviewsParams,
): Promise<ForgesToolResult<PageResult<PullRequestReview>>> {
  const params = repositoryTarget(args);
  const options: ListPullRequestReviewsOptions = {
    page: params.page,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const reviews = await provider.pullRequests.listReviews(
    params.owner,
    params.repo,
    params.number,
    options,
  );
  return result(
    params.platform,
    summarizeReviewPage(reviews),
    "Review bodies are truncated in list output; use forges_pull_requests_reviews_get to read one in full on GitHub or Gitea. GitLab entries are reviewer stances, not review bodies. Inline review comments are the threads forges_threads_list reads.",
  );
}

export async function getPullRequestReview(
  args: GetPullRequestReviewParams,
): Promise<ForgesToolResult<PullRequestReview>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const review = await provider.pullRequests.getReview(
    params.owner,
    params.repo,
    params.number,
    params.reviewId,
  );
  return result(params.platform, review);
}

export async function searchPullRequestsGlobal(
  args: SearchPullRequestsGlobalParams,
): Promise<
  ForgesToolResult<
    SearchPageResult<Omit<GlobalPullRequestSearchItem, "body">> & { resultLimit: number }
  >
> {
  const params = searchTarget(args);
  const provider = await readProvider(params.platform);
  const search = await provider.pullRequests.searchGlobal(params.query, {
    owner: params.owner,
    repo: params.repo,
    page: params.page,
    perPage: params.perPage,
    sort: params.sort,
    order: params.order,
  });
  return result(
    params.platform,
    { ...summarizeIssuePage(search), resultLimit: search.resultLimit },
    "Pull-request bodies and revision details are omitted; use forges_pull_requests_get with the hit's repository and number.",
  );
}

export async function searchPullRequests(
  args: SearchRepositoryPullRequestsParams,
): Promise<ForgesToolResult<SearchPageResult<Omit<PullRequestSearchItem, "body">>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const pullRequests = await provider.pullRequests.search(
    params.owner,
    params.repo,
    params.query,
    listOptions(params),
  );
  return result(
    params.platform,
    summarizeIssuePage(pullRequests),
    "Pull-request bodies and revision details are omitted from search output; use forges_pull_requests_get to read one in full.",
  );
}

export async function getPullRequest(
  args: GetPullRequestParams,
): Promise<ForgesToolResult<PullRequest>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const pullRequest = await provider.pullRequests.get(params.owner, params.repo, params.number, {
    closingIssues: params.closingIssues,
  });
  return result(params.platform, pullRequest);
}

export async function listPullRequestComments(
  args: ListCommentsParams,
): Promise<ForgesToolResult<PageResult<Comment>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const comments = await provider.pullRequests.listComments(
    params.owner,
    params.repo,
    params.number,
    commentListOptions(params),
  );
  return result(
    params.platform,
    summarizeCommentPage(comments),
    "Comment bodies are truncated in list output; use forges_pull_requests_comments_get to read one in full.",
  );
}

export async function getPullRequestComment(
  args: GetCommentParams,
): Promise<ForgesToolResult<Comment>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const comment = await provider.pullRequests.getComment(
    params.owner,
    params.repo,
    params.number,
    params.commentId,
  );
  return result(params.platform, comment);
}

export async function createPullRequestComment(
  args: CreateCommentParams,
): Promise<ForgesToolResult<Comment>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const comment = await provider.pullRequests.createComment(
      params.owner,
      params.repo,
      params.number,
      { body: params.body },
    );
    return result(params.platform, comment);
  });
}

export async function createPullRequest(
  args: CreatePullRequestParams,
): Promise<ForgesToolResult<PullRequest>> {
  const params = repositoryTarget(args);
  assertAssignees(params.assignees, params.platform);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const pullRequest = await provider.pullRequests.create(params.owner, params.repo, {
      title: params.title,
      body: params.body,
      sourceBranch: params.sourceBranch,
      targetBranch: params.targetBranch,
      draft: params.draft,
      assignees: params.assignees,
    });
    return result(
      params.platform,
      pullRequest,
      assignmentNote(params.assignees, pullRequest.assignees),
    );
  });
}

export async function updateIssue(args: UpdateIssueParams): Promise<ForgesToolResult<Issue>> {
  const params = repositoryTarget(args);
  const input: UpdateIssueInput = {
    title: params.title,
    body: params.body,
    state: params.state,
    addAssignees: params.addAssignees,
    removeAssignees: params.removeAssignees,
    addLabels: params.addLabels,
    removeLabels: params.removeLabels,
  };
  assertIssueUpdate(input, params.platform);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const issue = await provider.issues.update(params.owner, params.repo, params.number, input);
    return result(params.platform, issue, reassignmentNote(input, issue.assignees));
  });
}

export async function updatePullRequest(
  args: UpdatePullRequestParams,
): Promise<ForgesToolResult<PullRequest>> {
  const params = repositoryTarget(args);
  const input: UpdatePullRequestInput = {
    title: params.title,
    body: params.body,
    state: params.state,
    addAssignees: params.addAssignees,
    removeAssignees: params.removeAssignees,
    addLabels: params.addLabels,
    removeLabels: params.removeLabels,
  };
  assertPullRequestUpdate(input, params.platform);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const pullRequest = await provider.pullRequests.update(
      params.owner,
      params.repo,
      params.number,
      input,
    );
    return result(params.platform, pullRequest, reassignmentNote(input, pullRequest.assignees));
  });
}

export async function getUser(args: GetUserParams): Promise<ForgesToolResult<User>> {
  const params = platformTarget(args);
  const provider = await readProvider(params.platform);
  const user = await provider.users.get(params.username);
  return result(params.platform, user);
}

export type AuthenticatedUserParams = PlatformParams & AccountParams;

async function authenticatedUserResult(
  platform: ForgesPlatform,
  account: string | undefined,
): Promise<ForgesToolResult<User>> {
  const provider = await authenticatedProvider(platform, account);
  return result(platform, await provider.users.authenticated());
}

export function getAuthenticatedUser(
  args: AuthenticatedUserParams,
): Promise<ForgesToolResult<User>> {
  const params = platformTarget(args);
  return withCredentialOperation(params.platform, () =>
    authenticatedUserResult(params.platform, params.account),
  );
}

/** Replace one platform's pinned credentials and return the newly authenticated account. */
export function reloadAuthentication(
  args: AuthenticatedUserParams,
): Promise<ForgesToolResult<User>> {
  const params = platformTarget(args);
  return withCredentialOperation(params.platform, () => {
    resetPinnedProviders(params.platform);
    return authenticatedUserResult(params.platform, params.account);
  });
}

export interface ListThreadsParams extends RepositoryParams {
  number: number;
  page?: number;
  perPage?: number;
  state?: ThreadState;
}

export interface GetThreadParams extends RepositoryParams {
  number: number;
  threadId: string;
}

export type ThreadStateParams = GetThreadParams & AccountParams;

export type ReplyThreadParams = ThreadStateParams & ReplyThreadInput;

function summarizeThreadPage(page: PageResult<Thread>): PageResult<Thread> {
  return {
    ...page,
    items: page.items.map((thread) => ({
      ...thread,
      comments: thread.comments.map((comment) => ({
        ...comment,
        body: summarizeCommentBody(comment.body),
      })),
    })),
  };
}

function threadListOptions(params: ListThreadsParams): ListThreadOptions {
  return {
    page: params.page,
    perPage: params.perPage,
    state: params.state,
  };
}

export async function listThreads(
  args: ListThreadsParams,
): Promise<ForgesToolResult<PageResult<Thread>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const threads = await provider.threads.list(
    params.owner,
    params.repo,
    params.number,
    threadListOptions(params),
  );
  return result(
    params.platform,
    summarizeThreadPage(threads),
    "Comment bodies are truncated in list output; use forges_threads_get to read one full thread.",
  );
}

export async function getThread(args: GetThreadParams): Promise<ForgesToolResult<Thread>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const thread = await provider.threads.get(
    params.owner,
    params.repo,
    params.number,
    params.threadId,
  );
  return result(params.platform, thread);
}

export async function replyToThread(
  args: ReplyThreadParams,
): Promise<ForgesToolResult<ThreadComment>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const comment = await provider.threads.reply(
      params.owner,
      params.repo,
      params.number,
      params.threadId,
      { body: params.body },
    );
    return result(params.platform, comment);
  });
}

export async function resolveThread(args: ThreadStateParams): Promise<ForgesToolResult<Thread>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const thread = await provider.threads.resolve(
      params.owner,
      params.repo,
      params.number,
      params.threadId,
    );
    return result(params.platform, thread);
  });
}

export async function unresolveThread(args: ThreadStateParams): Promise<ForgesToolResult<Thread>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const thread = await provider.threads.unresolve(
      params.owner,
      params.repo,
      params.number,
      params.threadId,
    );
    return result(params.platform, thread);
  });
}

export async function verifyLocalMerge(
  params: VerifyLocalMergeOptions,
): Promise<ForgesToolResult<LocalMergeVerification>> {
  const local = await import("./local.ts");
  return result("local", await local.verifyLocalMerge(params));
}

export async function inspectLocal(
  params: InspectLocalOptions,
): Promise<ForgesToolResult<LocalInspection>> {
  const local = await import("./local.ts");
  return result("local", await local.inspectLocal(params));
}

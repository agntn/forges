import { createProvider, resolveToken, type AuthResult } from "./index.ts";
import type {
  InspectLocalOptions,
  LocalInspection,
  LocalMergeVerification,
  VerifyLocalMergeOptions,
} from "./local.ts";
import { assertAssignees } from "./assignees.ts";
import { quoted } from "./issue-fields.ts";
import { assertIssueUpdate, assertMergeInput, assertPullRequestUpdate } from "./update-input.ts";
import {
  readChecks,
  waitForChecks,
  type CheckPage,
  type ExpectedHead,
  type WaitedCheckPage,
} from "./check-wait.ts";
import {
  readComments,
  readReactions,
  type DiscussionWait,
  type ReactionWait,
} from "./discussion-wait.ts";
import { MAX_WAIT_SECONDS, type WaitProgress } from "./poll.ts";
import { AuthenticationError, FetchError, ForgesError, RateLimitError } from "./errors.ts";
import { redactEndpoint } from "./redact-endpoint.ts";
import {
  assertReleaseNotesOptions,
  sliceReleaseNotes,
  type ReleaseNotesOptions,
  type ReleaseNotesSlice,
} from "./release-notes.ts";
import {
  assertItemBodyOptions,
  itemBody,
  sliceItemBody,
  type ItemBodyOptions,
  type ItemBodySlice,
} from "./body-window.ts";
import { lazy } from "../extensions/shared/lazy.ts";
import { MAX_BATCH_ITEMS, type BatchItem } from "./batch.ts";
import { DEFAULT_WINDOW_CHARS, MAX_BODY_PREVIEW_CHARS, MAX_WINDOW_CHARS } from "./text-window.ts";
import { isCommitSha } from "./repository-contents.ts";
import type { ForgesPlatform } from "./tool-schemas.ts";
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
  CommitComparison,
  CommitPatch,
  CommitPatchOptions,
  ContributionTemplate,
  ContributionTemplateKind,
  ContributionTemplateSummary,
  CommitSummary,
  CommitSearchItem,
  CommitSearchOptions,
  CommitSearchResult,
  CompareCommitsOptions,
  CreateCommentInput,
  CreateIssueInput,
  CreatePullRequestInput,
  CreateReleaseInput,
  Issue,
  IssueFields,
  IssueFieldValue,
  IssueNumber,
  IssueRef,
  IssueState,
  ListCiRunsOptions,
  ListCommentOptions,
  ListCommitChecksOptions,
  ListCommitOptions,
  ListContributionTemplatesOptions,
  ListEventOptions,
  ListOptions,
  ListPullRequestChecksOptions,
  ListPullRequestFilesOptions,
  ListPullRequestReviewsOptions,
  ListReactionOptions,
  ListReleasesOptions,
  ListRepositoryTreeOptions,
  ListTagsOptions,
  ListThreadOptions,
  MergePullRequestInput,
  PageResult,
  PullRequest,
  PullRequestCheck,
  PullRequestFile,
  PullRequestReview,
  PullRequestSearchItem,
  Reaction,
  GlobalPullRequestSearchOptions,
  GlobalPullRequestSearchItem,
  GlobalIssueSearchOptions,
  GlobalIssueSearchItem,
  Release,
  RepoRef,
  ReplyThreadInput,
  Repository,
  RepositoryContents,
  RepositoryTreePage,
  RepositoryContentsOptions,
  SearchPageResult,
  SubIssue,
  Tag,
  Thread,
  ThreadComment,
  ThreadEvent,
  ThreadEventKind,
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
  bitbucket: "FORGES_BITBUCKET_BASE_URL",
  gitee: "FORGES_GITEE_BASE_URL",
  "azure-devops": "FORGES_AZURE_DEVOPS_BASE_URL",
  gitcafe: "FORGES_GITCAFE_BASE_URL",
  pushin: "FORGES_PUSHIN_BASE_URL",
  tangled: "FORGES_TANGLED_BASE_URL",
  artifacts: "FORGES_ARTIFACTS_BASE_URL",
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

/** The API host each provider calls while its `FORGES_*_BASE_URL` is unset. */
const DEFAULT_API_HOSTS = [
  "api.github.com",
  "gitlab.com",
  "gitea.com",
  "api.bitbucket.org",
  "gitee.com",
  "dev.azure.com",
  "git.cafe",
  "pushin.eu",
  "tangled.org",
  "api.cloudflare.com",
] as const;

/**
 * Every host a provider may call: the defaults and each `FORGES_*_BASE_URL` set right now.
 * A base URL that does not parse leaves its host unknown, so every URL goes instead.
 */
function forgeHosts(): Set<string> | undefined {
  const hosts = new Set<string>(DEFAULT_API_HOSTS);
  for (const name of Object.values(baseUrlEnvByPlatform)) {
    const value = process.env[name];
    if (value === undefined || value === "") continue;
    if (!URL.canParse(value)) return undefined;
    hosts.add(new URL(value).hostname.toLowerCase().replace(/\.$/, ""));
  }
  return hosts;
}

/** A message with its request line and forge URLs gone, and vendor links kept. */
function withoutEndpoint(message: string): string {
  return redactEndpoint(message, forgeHosts());
}

/** An account key extends its platform key, so a platform reset drops it too. */
function providerKey(platform: ForgesPlatform, account?: string): string {
  const baseURL = process.env[baseUrlEnvByPlatform[platform]];
  const key = baseURL === undefined ? platform : `${platform} ${baseURL}`;
  return account === undefined ? key : `${key} @${account.toLowerCase()}`;
}

/** The local credential, or null when the chain found none or an empty token asks for none. */
function configuredCredential(platform: Exclude<ForgesPlatform, "artifacts">): AuthResult | null {
  const baseURL = process.env[baseUrlEnvByPlatform[platform]];
  const credential = resolveToken(platform, { baseURL });
  return credential === null || credential.token === "" ? null : credential;
}

/** A null credential reads anonymously, or means the Cloudflare chain on artifacts. */
async function createConfiguredProvider(
  platform: ForgesPlatform,
  credential: AuthResult | null,
): Promise<Provider> {
  const token = credential?.token ?? "";
  const baseURL = process.env[baseUrlEnvByPlatform[platform]];
  const provider = await createProvider(platform, {
    token,
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(credential?.username === undefined ? {} : { username: credential.username }),
  });
  return explainFailures(provider, {
    platform,
    credential:
      credential === null ? undefined : { source: credential.source, origin: credential.origin },
  });
}

/** Cloudflare reads nothing without a token, so artifacts keeps one provider for every call. */
function artifactsProvider(): Promise<Provider> {
  const key = providerKey("artifacts");
  return (
    pinnedProviders.get(key) ??
    trackProvider(pinnedProviders, { key, load: () => createConfiguredProvider("artifacts", null) })
  );
}

/** Start one provider load under a key and forget it again if the load fails. */
function trackProvider(
  providers: Map<string, Promise<Provider>>,
  entry: Readonly<{ key: string; load: () => Promise<Provider> }>,
): Promise<Provider> {
  const { key, load } = entry;
  const provider = load();
  providers.set(key, provider);
  provider.catch(() => {
    if (providers.get(key) === provider) providers.delete(key);
  });
  return provider;
}

/** What a missing credential is told to set up; Bitbucket, Gitee and Tangled have no login. */
const credentialSetup: Record<ForgesPlatform, Readonly<{ variable: string; login?: string }>> = {
  github: { variable: "GITHUB_TOKEN", login: "gh auth login" },
  gitlab: { variable: "GITLAB_TOKEN", login: "glab auth login" },
  gitea: { variable: "GITEA_TOKEN", login: "tea login add" },
  bitbucket: { variable: "BITBUCKET_TOKEN, or BITBUCKET_API_TOKEN with BITBUCKET_EMAIL" },
  gitee: { variable: "GITEE_TOKEN" },
  "azure-devops": { variable: "AZURE_DEVOPS_EXT_PAT", login: "az devops login" },
  gitcafe: { variable: "CAFE_TOKEN", login: "cafe auth login" },
  pushin: { variable: "PUSHIN_TOKEN", login: "pun login" },
  tangled: { variable: "TANGLED_HANDLE with TANGLED_PASSWORD, an app password" },
  artifacts: {
    variable: "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID",
    login: "cf auth login",
  },
};

/** The CLI behind each forge login. */
const loginCli = {
  github: "gh",
  gitlab: "glab",
  gitea: "tea",
  "azure-devops": "az devops",
  gitcafe: "cafe",
  pushin: "pun",
} satisfies Record<
  Exclude<ForgesPlatform, "artifacts" | "bitbucket" | "gitee" | "tangled">,
  string
>;

function credentialSetupHint(platform: ForgesPlatform): string {
  const { variable, login } = credentialSetup[platform];
  return login === undefined ? `Set ${variable}.` : `Set ${variable} or log in with \`${login}\`.`;
}

/** The way past a rejected token, which stays pinned until forges_auth_reload drops it. */
function rejectedTokenHint(
  platform: Exclude<ForgesPlatform, "artifacts">,
  credential: TokenOrigin,
): string {
  const { source, origin } = credential;
  const expired = "was rejected, so it has likely expired or been revoked.";
  const reload = "then call forges_auth_reload and retry.";
  if (platform === "tangled") {
    return `The Tangled app password from ${origin} ${expired} Create a new one, or check that TANGLED_HANDLE names its account, ${reload}`;
  }
  if (platform === "bitbucket" || platform === "gitee") {
    const where = source === "env" ? `from ${origin} ` : "";
    return `The ${platform} token ${where}${expired} Replace it, ${reload}`;
  }
  const cli = loginCli[platform];
  const { variable, login } = credentialSetup[platform];
  switch (source) {
    case "env":
      return `The ${platform} token from ${origin} ${expired} That variable wins over the \`${cli}\` login: replace or unset it, ${reload}`;
    case "config":
      return `The ${platform} token saved in \`${origin}\` ${expired} Set ${variable}, which wins over that file, or redo the login with \`${login}\`, ${reload}`;
    default:
      return `The ${platform} token of the local \`${cli}\` login ${expired} Log in again with \`${login}\`, ${reload}`;
  }
}

/** No reload here: the next request asks the Cloudflare chain again. */
const REJECTED_CLOUDFLARE_TOKEN =
  "The Cloudflare token was rejected, so it has likely expired or been revoked. CLOUDFLARE_API_TOKEN wins over the `cf` session: replace or unset it, or log in again with `cf auth login` when it is not set, then retry.";

async function authenticatedProvider(
  platform: ForgesPlatform,
  account?: string,
): Promise<Provider> {
  if (account !== undefined) return accountProvider(platform, account);
  if (platform === "artifacts") return artifactsProvider();

  const key = providerKey(platform);
  const pinned = pinnedProviders.get(key);
  if (pinned) return pinned;

  const credential = configuredCredential(platform);
  if (credential === null) {
    throw new AuthenticationError(
      `No auth token found for ${platform}. ${credentialSetupHint(platform)}`,
      { platform },
    );
  }

  return trackProvider(pinnedProviders, {
    key,
    load: () => createConfiguredProvider(platform, credential),
  });
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
      { status: 501, platform },
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
      { platform },
    );
  }

  return trackProvider(pinnedProviders, {
    key,
    load: () => verifiedAccountProvider(platform, { account, credential }),
  });
}

async function verifiedAccountProvider(
  platform: ForgesPlatform,
  login: Readonly<{ account: string; credential: AuthResult }>,
): Promise<Provider> {
  const { account, credential } = login;
  const provider = await createConfiguredProvider(platform, credential);
  const actual = (await provider.users.authenticated()).login;
  if (actual.toLowerCase() === account.toLowerCase()) return provider;

  const hint =
    credential.source === "env"
      ? `${credential.origin} is set and takes precedence; unset it to use the gh login.`
      : "Check `gh auth status`.";
  throw new AuthenticationError(
    `Refusing to act as "${account}": the ${platform} token found for it belongs to "${actual}". ${hint}`,
    { platform },
  );
}

function readProvider(platform: ForgesPlatform): Promise<Provider> {
  if (platform === "artifacts") return artifactsProvider();
  const key = providerKey(platform);
  const authenticated = pinnedProviders.get(key);
  if (authenticated) return authenticated;

  const credential = configuredCredential(platform);
  if (credential !== null) {
    anonymousReadProviders.delete(key);
    return trackProvider(pinnedProviders, {
      key,
      load: () => createConfiguredProvider(platform, credential),
    });
  }

  return (
    anonymousReadProviders.get(key) ??
    trackProvider(anonymousReadProviders, {
      key,
      load: () => createConfiguredProvider(platform, null),
    })
  );
}

const ANONYMOUS_REFUSALS = new Set([401, 403, 404, 429]);
/** Failures already explained, since callers sharing one in-flight load get the same error. */
const explainedFailures = new WeakSet<ForgesError>();

/** A failure as the model reads it: no endpoint, a status for an empty message, an abort as is. */
export function toolFailure(error: unknown): Error {
  if (error instanceof ForgesError && explainedFailures.has(error)) return error;
  if (error instanceof Error && error.name === "AbortError") return error;
  const failure = error instanceof Error ? error : new Error(String(error));
  const status = failure instanceof ForgesError ? failure.status : undefined;
  failure.message =
    withoutEndpoint(failure.message) ||
    (status === undefined ? "no reason reported" : `HTTP ${status}`);
  return failure;
}

/** Which step found a token, and where: `env` and `GL_TOKEN`, say. */
type TokenOrigin = Readonly<Pick<AuthResult, "source" | "origin">>;

/** The platform a request went to, and where its token came from when it carried one. */
interface RequestOrigin {
  platform: ForgesPlatform;
  credential: TokenOrigin | undefined;
}

/** What a refusal the server sent needs next, by whether the request carried a token. */
function refusalHint(status: number, origin: RequestOrigin): string | undefined {
  const { platform, credential } = origin;
  /** artifacts asks the Cloudflare chain on every request and never reads anonymously. */
  if (platform === "artifacts") return status === 401 ? REJECTED_CLOUDFLARE_TOKEN : undefined;
  if (credential !== undefined) {
    return status === 401 ? rejectedTokenHint(platform, credential) : undefined;
  }
  if (!ANONYMOUS_REFUSALS.has(status)) return undefined;

  const reason =
    status === 404
      ? `The request carried no token, and ${platform} answers 404 for a private repository as well as a missing one.`
      : status === 429
        ? "The request carried no token, and requests without one get a far lower rate limit."
        : "The request carried no token.";
  return `${reason} ${credentialSetupHint(platform)} Then retry.`;
}

/** Join a sentence to a message that may or may not end with a period. */
function appendSentence(message: string, sentence: string): string {
  return `${message.trimEnd().replace(/\.?$/, ".")} ${sentence}`;
}

/**
 * Rewrite a provider failure into the text every agent surface shows the model.
 *
 * Pi and OMP hand `error.message` to the model as it is, so the rewrite belongs
 * here and not in one surface. The endpoint leaves the message, a rate limit
 * names its retry window, and a refusal of a tokenless read says that no token
 * was sent: a private repository answers 404 to such a request, exactly like one
 * that does not exist, so without it the agent concludes the repository is
 * missing. A rejected token names where it came from and how to replace it.
 * Only refusals the server sent get those sentences; a provider's own 404, such
 * as a template key missing from its list, means the item really is absent.
 * The original FetchError, URL included, stays on `originalError`.
 */
function explainFailures(provider: Provider, origin: RequestOrigin): Provider {
  const explain = (error: unknown): unknown => {
    if (!(error instanceof ForgesError) || explainedFailures.has(error)) return error;
    explainedFailures.add(error);

    error.message =
      withoutEndpoint(error.message) ||
      (error.status === undefined ? "no reason reported" : `HTTP ${error.status}`);
    if (error instanceof RateLimitError && error.retryAfter !== undefined) {
      error.message = appendSentence(error.message, `Retry after ${error.retryAfter}s.`);
    }

    if (!(error.originalError instanceof FetchError) || error.status === undefined) return error;
    const hint = refusalHint(error.status, origin);
    if (hint !== undefined) error.message = appendSentence(error.message, hint);
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

/** What the host hands an executor next to its arguments. */
export interface CallOptions {
  /** Aborted when the host cancels the call; a wait stops polling on it. */
  signal?: AbortSignal;
  /** Where a wait reports how long it has been at it, so the host doesn't hang up. */
  progress?: WaitProgress;
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
  return new ForgesError(message, { platform });
}

/**
 * Split an `owner/name` slug written into `repo`.
 *
 * Every forge, its web UI and its CLI write a repository that way, so a caller
 * holding the slug tends to pass it whole, often with `owner` repeated next to
 * it. A repeated owner is redundant and the slug wins. An `owner` that names
 * someone else is contradictory, and is rejected instead of one of the two being
 * picked silently. Logins compare without case, as all three forges treat them.
 * Azure DevOps nests a repository in a project, so its slug may carry one more
 * segment: `organization/project/name`.
 */
function splitRepository(
  target: Readonly<{ repo: string; owner?: string }>,
  platform: ForgesPlatform,
): { owner: string | undefined; repo: string } {
  const { repo, owner } = target;
  if (!repo.includes("/")) return { owner, repo };

  const segments = repo.split("/");
  const slugRepo = segments.pop();
  const slugOwner = segments.join("/");
  if (segments.length > ownerSegments(platform) || segments.some((part) => !part) || !slugRepo) {
    throw targetError(
      platform === "azure-devops"
        ? `Invalid repository "${repo}": pass a bare name, or "organization/project/name".`
        : `Invalid repository "${repo}": pass a bare name, or "owner/name" with exactly one slash.`,
      platform,
    );
  }

  if (owner !== undefined && owner.toLowerCase() !== slugOwner.toLowerCase()) {
    throw targetError(
      `Ambiguous repository: owner "${owner}" was passed with repo "${repo}". Pass either owner and a bare repo name, or repo alone as "owner/name".`,
      platform,
    );
  }

  return { owner: slugOwner, repo: slugRepo };
}

/** Azure DevOps owners can be `organization/project`, every other owner is one segment. */
function ownerSegments(platform: ForgesPlatform): number {
  return platform === "azure-devops" ? 2 : 1;
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
  const { owner, repo } = splitRepository(params, platform);
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
  const { owner, repo } = splitRepository({ repo: params.repo, owner: params.owner }, platform);
  return { ...params, platform, owner, repo };
}

export interface ListRepositoriesParams extends OwnerParams {
  cursor?: string;
  perPage?: number;
}

export type GetRepositoryParams = RepositoryParams;

export interface ListContributionTemplatesParams extends RepositoryParams {
  readonly kind: ContributionTemplateKind;
  readonly cursor?: string;
  readonly perPage?: number;
}

export interface GetContributionTemplateParams extends RepositoryParams {
  readonly kind: ContributionTemplateKind;
  readonly key: string;
}

/** How much of each hit's body a search returns. */
export interface BodyPreviewParams {
  bodyChars?: number;
}

export interface SearchPullRequestsGlobalParams
  extends PlatformParams, GlobalPullRequestSearchOptions, BodyPreviewParams {
  query?: string;
}

export interface SearchIssuesGlobalParams
  extends PlatformParams, GlobalIssueSearchOptions, BodyPreviewParams {
  query?: string;
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

export type ListRepositoryTreeParams = RepositoryParams & ListRepositoryTreeOptions;

export type ReadCommitPatchParams = RepositoryParams & CommitPatchOptions & { sha: string };

export type ListCommitsParams = RepositoryParams & ListCommitOptions;

export type ListCommitChecksParams = RepositoryParams &
  ListCommitChecksOptions & { ref: string; waitSeconds?: number };

export type CompareCommitsParams = RepositoryParams &
  CompareCommitsOptions & { base: string; head: string; files?: boolean };

export interface ListCiRunsParams extends RepositoryParams {
  branch?: string;
  workflow?: string;
  cursor?: string;
  perPage?: number;
}

export interface ListCiJobsParams extends RepositoryParams {
  runId: string;
  cursor?: string;
  perPage?: number;
}

export type ReadCiJobLogParams = RepositoryParams & CiJobLogOptions & { jobId: string };

export interface ListReleasesParams extends RepositoryParams {
  cursor?: string;
  perPage?: number;
}

export interface ListTagsParams extends RepositoryParams {
  cursor?: string;
  perPage?: number;
}

export interface GetReleaseParams extends RepositoryParams, ReleaseNotesOptions {
  tag: string;
}

export type CreateReleaseParams = RepositoryParams & AccountParams & CreateReleaseInput;

export type UpdateReleaseParams = RepositoryParams & { tag: string } & AccountParams &
  UpdateReleaseInput;

export interface ListRepositoryItemsParams extends RepositoryParams {
  cursor?: string;
  perPage?: number;
  state?: IssueState | "all";
}

export interface SearchRepositoryItemsParams extends ListRepositoryItemsParams, BodyPreviewParams {
  query: string;
}

export type SearchRepositoryIssuesParams = SearchRepositoryItemsParams;
export type SearchRepositoryPullRequestsParams = SearchRepositoryItemsParams;

export interface GetRepositoryItemParams extends RepositoryParams {
  number: IssueRef["number"];
}

export type CreateIssueParams = RepositoryParams & AccountParams & CreateIssueInput;

type IssueMetadataParams = Pick<UpdateIssueInput, "type" | "clearType" | "fields" | "clearFields">;

export type IssueFieldsParams = RepositoryParams;

export type CreatePullRequestParams = RepositoryParams & AccountParams & CreatePullRequestInput;

export type UpdateIssueParams = GetRepositoryItemParams & AccountParams & UpdateIssueInput;

export type UpdatePullRequestParams = GetRepositoryItemParams &
  AccountParams &
  UpdatePullRequestInput;

export type MergePullRequestParams = GetRepositoryItemParams &
  AccountParams &
  MergePullRequestInput;

export interface ListCommentsParams extends RepositoryParams {
  number: IssueRef["number"];
  cursor?: string;
  perPage?: number;
}

export type ListPullRequestFilesParams = ListCommentsParams;
export type ListPullRequestReviewsParams = ListCommentsParams;

export interface ListPullRequestChecksParams extends ListCommentsParams {
  /** Seconds to wait for every check to conclude; absent reads the current state once. */
  waitSeconds?: number;
  /** The commit just pushed. Checks are listed only once the pull request points at it. */
  headSha?: string;
}

/** One key, or a batch of them. */
export type OneOrBatch<T> = T | readonly T[];

export interface GetIssueParams extends RepositoryParams, ItemBodyOptions {
  number: OneOrBatch<IssueRef["number"]>;
}

export interface GetPullRequestParams extends RepositoryParams, ItemBodyOptions {
  number: OneOrBatch<number>;
  /** Also list the issues the pull request closes on merge. */
  closingIssues?: boolean;
}

export interface GetPullRequestReviewParams extends GetRepositoryItemParams {
  reviewId: string;
}

export interface ListReactionsParams extends ListCommentsParams {
  commentId?: string;
}

export interface ListEventsParams extends ListCommentsParams {
  kinds?: ThreadEventKind[];
}

/** The pull-request conversation, optionally narrowed and waited on for a bot's next edit. */
export interface ListPullRequestCommentsParams extends ListCommentsParams {
  /** Only comments whose body contains this text, such as a bot's hidden sticky marker. */
  marker?: string;
  /** Only comments created or edited at or after this ISO 8601 time. */
  since?: string;
  /** Seconds to wait for a matching comment to be created or edited; absent reads once. */
  waitSeconds?: number;
}

/** Reactions on a pull request, optionally narrowed and waited on for a bot's next one. */
export interface ListPullRequestReactionsParams extends ListReactionsParams {
  /** Only reactions left by this login. */
  author?: string;
  /** Only reactions left at or after this ISO 8601 time. */
  since?: string;
  /** Seconds to wait for a matching reaction to land or go away; absent reads once. */
  waitSeconds?: number;
}

export type ListSubIssuesParams = ListCommentsParams;

export interface SubIssueParams extends GetRepositoryItemParams, AccountParams {
  subIssue: number;
}

export interface AddSubIssueParams extends SubIssueParams {
  replaceParent?: boolean;
}

export interface GetCommentParams extends RepositoryParams {
  number: IssueRef["number"];
  commentId: string;
}

export type CreateCommentParams = GetRepositoryItemParams & AccountParams & CreateCommentInput;

export type UpdateCommentParams = CreateCommentParams & { commentId: string };

export type DeleteCommentParams = GetCommentParams & AccountParams;

/** A delete gets nothing back from the forge, so the answer names what is gone. */
export interface CommentDeletion {
  deleted: true;
  commentId: string;
}

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

/** Where the value came from, a note for the model, and a `modelValue` for its text only. */
interface ResultMeta {
  platform: ForgesPlatform | "local";
  note?: string;
  modelValue?: unknown;
}

function result<T>(value: T, meta: ResultMeta): ForgesToolResult<T> {
  const { platform, note, modelValue = value } = meta;
  const details = { platform, result: value };
  const modelDetails = note
    ? { platform, result: modelValue, note }
    : { platform, result: modelValue };
  return {
    content: [{ type: "text", text: JSON.stringify(modelDetails) }],
    details,
  };
}

function assignmentNote(
  requested: string[] | undefined,
  actual: Array<{ login: string }>,
  reason?: string,
): string | undefined {
  if (!requested?.length) return undefined;
  const assigned = new Set(actual.map(({ login }) => login.toLowerCase()));
  const missing = requested.filter((login) => !assigned.has(login.toLowerCase()));
  if (missing.length === 0) return undefined;
  const why = reason === undefined ? "" : ` (${reason})`;
  return `Requested assignees are missing: ${missing.join(", ")}${why}. The create itself went through, so do not retry it; the result is the created object.`;
}

function sameFieldValue(wanted: IssueFieldValue, actual: IssueFieldValue | undefined): boolean {
  const names = (value: IssueFieldValue | undefined) =>
    (Array.isArray(value) ? value : [value]).map((entry) => String(entry).toLowerCase()).toSorted();
  return actual !== undefined && names(wanted).join("\n") === names(actual).join("\n");
}

/** GitHub drops what an account without push access sets, so the result is checked against it. */
function metadataProblems(params: IssueMetadataParams, issue: Issue): string[] {
  const actual = new Map(
    Object.entries(issue.fields ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const problems = Object.entries(params.fields ?? {})
    .filter(([name, value]) => !sameFieldValue(value, actual.get(name.toLowerCase())))
    .map(([name]) => `${quoted(name)} not set`);
  problems.push(
    ...(params.clearFields ?? [])
      .filter((name) => actual.has(name.toLowerCase()))
      .map((name) => `${quoted(name)} still set`),
  );
  if (params.type !== undefined && issue.type?.toLowerCase() !== params.type.toLowerCase()) {
    problems.unshift(`type not ${quoted(params.type)}`);
  }
  if (params.clearType === true && issue.type !== null && issue.type !== undefined) {
    problems.unshift(`type still ${quoted(issue.type)}`);
  }
  return problems;
}

function metadataNote(
  params: IssueMetadataParams,
  about: Readonly<{ issue: Issue; verb: "Creation" | "Update" }>,
): string | undefined {
  const problems = metadataProblems(params, about.issue);
  if (problems.length === 0) return undefined;
  return `${about.verb} succeeded, but the issue type and fields did not land as asked (${problems.join("; ")}). GitHub drops them without push access; the result shows what the issue carries now.`;
}

/** OMP fills an unused field with "" or false, which means nothing was asked. */
function issueMetadataParams(params: IssueMetadataParams): IssueMetadataParams {
  return {
    type: params.type === "" ? undefined : params.type,
    clearType: params.clearType === true ? true : undefined,
    fields: Object.keys(params.fields ?? {}).length > 0 ? params.fields : undefined,
    clearFields: params.clearFields?.length ? params.clearFields : undefined,
  };
}

function joinNotes(...notes: Array<string | undefined>): string | undefined {
  const present = notes.filter((note) => note !== undefined);
  return present.length > 0 ? present.join(" ") : undefined;
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
  return `The assignees did not change as asked (${problems.join("; ")}), though the rest of the update went through. The result shows who is assigned now.`;
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

/** A search hit with the start of its body. */
export type BodyPreview<T extends Issue> = T & { bodyTruncated?: true };

/** Rows with no body, or just the start of one. */
export type SearchHitPage<T extends Issue> = SearchPageResult<Omit<T, "body"> | BodyPreview<T>>;

/** OMP sends 0 for an unused field, so 0 means no preview. */
function bodyPreviewChars(params: BodyPreviewParams & { platform: ForgesPlatform }): number {
  const { bodyChars, platform } = params;
  if (bodyChars === undefined) return 0;
  if (!Number.isInteger(bodyChars) || bodyChars < 0 || bodyChars > MAX_BODY_PREVIEW_CHARS) {
    throw new ForgesError(`bodyChars must be an integer from 0 to ${MAX_BODY_PREVIEW_CHARS}`, {
      status: 400,
      platform,
    });
  }
  return bodyChars;
}

/** An emoji at the cut goes whole or not at all. */
function previewBody(body: string, chars: number): { body: string; truncated: boolean } {
  if (body.length <= chars) return { body, truncated: false };
  const end = /^[\uD800-\uDBFF]$/.test(body.slice(chars - 1, chars)) ? chars - 1 : chars;
  return { body: body.slice(0, end), truncated: true };
}

/** No bodies at 0, the start of each above it. */
function searchHitPage<T extends Issue>(
  page: SearchPageResult<T>,
  chars: number,
): SearchHitPage<T> {
  if (chars === 0) return summarizeIssuePage(page);
  return {
    ...page,
    items: page.items.map((item) => {
      const { body, truncated } = previewBody(item.body, chars);
      return truncated ? { ...item, body, bodyTruncated: true as const } : { ...item, body };
    }),
  };
}

/** Previews get a pointer to the full read; no previews, the old note. */
function searchBodyNote(chars: number, notes: Readonly<{ omitted: string; read: string }>): string {
  return chars === 0
    ? notes.omitted
    : `Bodies are cut to bodyChars, and bodyTruncated marks the cut ones; use ${notes.read} to read one in full.`;
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

/** files and filesComplete are left out unless the caller asked for files. */
export interface CommitComparisonResult extends Omit<CommitComparison, "files" | "filesComplete"> {
  items: CommitListItem[];
  files?: CommitComparison["files"];
  filesComplete?: CommitComparison["filesComplete"];
}

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

/**
 * A direct push has its author as committer at the same second, so the model text drops a
 * committer that repeats the author field for field. A rebase, a squash merge or a web edit
 * keeps it.
 */
function commitRowText<T extends CommitSummary>(commit: T): T | Omit<T, "committer"> {
  const { author, committer } = commit;
  if (
    committer.name !== author.name ||
    committer.email !== author.email ||
    committer.date !== author.date
  ) {
    return commit;
  }
  const { committer: _committer, ...row } = commit;
  return row;
}

const REPEATED_COMMITTER_NOTE = "A committer identical to the author is left out of the row.";

type PullRequestRow = Omit<PullRequest, "body">;

/** An unmerged row has blank merge fields, and a list seldom knows mergeability. */
function pullRequestRowText(pullRequest: PullRequestRow): Partial<PullRequestRow> {
  const { mergeCommitSha, mergedAt, mergedBy, mergeable, mergeStatus, ...row } = pullRequest;
  return {
    ...row,
    ...(pullRequest.merged ? { mergeCommitSha, mergedAt, mergedBy } : {}),
    ...(mergeable === null ? {} : { mergeable }),
    ...(mergeStatus === "" ? {} : { mergeStatus }),
  };
}

/** The repository a tool call names, without the rest of its arguments. */
function repoOf({ owner, repo }: RepoRef): RepoRef {
  return { owner, repo };
}

/** The issue or pull request a tool call names, without the rest of its arguments. */
function issueOf({ owner, repo, number }: IssueRef): IssueRef {
  return { owner, repo, number };
}

function listOptions(params: {
  cursor?: string;
  perPage?: number;
  state?: IssueState | "all";
}): ListOptions {
  return {
    cursor: params.cursor,
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
  const owner = params.owner.toLowerCase();
  return result(repositories, {
    platform: params.platform,
    modelValue: {
      ...repositories,
      items: repositories.items.map((repository) => repositoryRowText(repository, owner)),
    },
  });
}

/**
 * The model text drops merge settings, which forges_repos_get has, and an owner that repeats the
 * one asked for. `fullName` keeps the login's case, and a GitLab group's shared project its owner.
 */
function repositoryRowText(
  repository: Repository,
  owner: string,
): Omit<Repository, "merge"> | Omit<Repository, "merge" | "owner"> {
  const { merge: _merge, ...row } = repository;
  if (row.owner.login.toLowerCase() !== owner) return row;
  const { owner: _owner, ...ownRow } = row;
  return ownRow;
}

export async function getRepository(
  args: GetRepositoryParams,
): Promise<ForgesToolResult<Repository>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const repository = await provider.repos.get(repoOf(params));
  return result(repository, { platform: params.platform });
}

export async function getIssueFields(
  args: IssueFieldsParams,
): Promise<ForgesToolResult<IssueFields>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  return result(await provider.issues.getFields(repoOf(params)), { platform: params.platform });
}

export async function listContributionTemplates(
  args: ListContributionTemplatesParams,
): Promise<ForgesToolResult<PageResult<ContributionTemplateSummary>>> {
  const params = repositoryTarget(args);
  const options: ListContributionTemplatesOptions = {
    cursor: params.cursor,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const templates = await provider.contributionTemplates.list(repoOf(params), {
    kind: params.kind,
    ...options,
  });
  return result(templates, {
    platform: params.platform,
    note: "Template bodies are omitted from list output; use forges_contribution_templates_get with the returned kind and key.",
  });
}

export async function getContributionTemplate(
  args: GetContributionTemplateParams,
): Promise<ForgesToolResult<ContributionTemplate>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const template = await provider.contributionTemplates.get(repoOf(params), {
    kind: params.kind,
    key: params.key,
  });
  return result(template, { platform: params.platform });
}

export async function searchCode(
  args: SearchCodeParams,
): Promise<ForgesToolResult<SearchPageResult<CodeSearchItem>>> {
  const params = searchTarget(args);
  const provider = await readProvider(params.platform);
  const search = await provider.code.search(params.query, {
    owner: params.owner,
    repo: params.repo,
    cursor: params.cursor,
    perPage: params.perPage,
  });
  return result(search, { platform: params.platform });
}

export async function listCiRuns(
  args: ListCiRunsParams,
): Promise<ForgesToolResult<PageResult<CiRun>>> {
  const params = repositoryTarget(args);
  const options: ListCiRunsOptions = {
    branch: params.branch,
    workflow: params.workflow,
    cursor: params.cursor,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const runs = await provider.ciRuns.list(repoOf(params), options);
  return result(runs, { platform: params.platform });
}

export async function listCiJobs(
  args: ListCiJobsParams,
): Promise<ForgesToolResult<PageResult<CiJob>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const jobs = await provider.ciRuns.listJobs(repoOf(params), {
    runId: params.runId,
    cursor: params.cursor,
    perPage: params.perPage,
  });
  return result(jobs, { platform: params.platform });
}

export async function readCiJobLog(args: ReadCiJobLogParams): Promise<ForgesToolResult<CiJobLog>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const log = await provider.ciRuns.readJobLog(repoOf(params), {
    jobId: params.jobId,
    offset: params.offset,
    maxChars: params.maxChars,
  });
  return result(log, { platform: params.platform });
}

export async function searchCommits(
  args: SearchCommitsParams,
): Promise<ForgesToolResult<CommitSearchListResult>> {
  const params = searchTarget(args);
  const provider = await readProvider(params.platform);
  const search = await provider.commits.search(params.query, {
    owner: params.owner,
    repo: params.repo,
    cursor: params.cursor,
    perPage: params.perPage,
  });
  const items = search.items.map(summarizeCommit);
  return result(
    { ...search, items },
    {
      platform: params.platform,
      note: `Commit messages are cut to their subject line in search output, and messageTruncated marks each one that lost text; use forges_commits_get with the item's repository and sha to read one in full. ${REPEATED_COMMITTER_NOTE}`,
      modelValue: { ...search, items: items.map(commitRowText) },
    },
  );
}

export async function listCommits(
  args: ListCommitsParams,
): Promise<ForgesToolResult<PageResult<CommitListItem>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const commits = await provider.commits.list(repoOf(params), {
    ref: params.ref,
    path: params.path,
    since: params.since,
    until: params.until,
    cursor: params.cursor,
    perPage: params.perPage,
  });
  const items = commits.items.map(summarizeCommit);
  return result(
    { ...commits, items },
    {
      platform: params.platform,
      note: `Commit messages are cut to their subject line in list output, and messageTruncated marks each one that lost text; use forges_commits_get to read one in full. ${REPEATED_COMMITTER_NOTE}`,
      modelValue: { ...commits, items: items.map(commitRowText) },
    },
  );
}

export async function compareCommits(
  args: CompareCommitsParams,
): Promise<ForgesToolResult<CommitComparisonResult>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const comparison = await provider.commits.compare(repoOf(params), {
    base: params.base,
    head: params.head,
    cursor: params.cursor,
    perPage: params.perPage,
  });
  const { files, filesComplete, ...rest } = comparison;
  const items = comparison.items.map(summarizeCommit);
  const range = { ...rest, items, ...(params.files ? { files, filesComplete } : {}) };
  return result(range, {
    platform: params.platform,
    note: `Commit messages are cut to their subject line in comparison output, and messageTruncated marks each one that lost text; use forges_commits_get to read one in full. ${REPEATED_COMMITTER_NOTE}`,
    modelValue: { ...range, items: items.map(commitRowText) },
  });
}

export async function readRepositoryContents(
  args: ReadRepositoryContentsParams,
): Promise<ForgesToolResult<RepositoryContents>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const contents = await provider.repos.readContents(repoOf(params), {
    path: params.path,
    ref: params.ref,
    offset: params.offset,
    maxChars: params.maxChars,
  });
  return result(contents, { platform: params.platform });
}

export async function listRepositoryTree(
  args: ListRepositoryTreeParams,
): Promise<ForgesToolResult<RepositoryTreePage>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const tree = await provider.repos.listTree(repoOf(params), {
    path: params.path,
    ref: params.ref,
    cursor: params.cursor,
    perPage: params.perPage,
  });
  return result(tree, { platform: params.platform });
}

export async function listTags(args: ListTagsParams): Promise<ForgesToolResult<PageResult<Tag>>> {
  const params = repositoryTarget(args);
  const options: ListTagsOptions = { cursor: params.cursor, perPage: params.perPage };
  const provider = await readProvider(params.platform);
  const tags = await provider.repos.listTags(repoOf(params), options);
  return result(tags, { platform: params.platform });
}

export async function getCommit(args: GetCommitParams): Promise<ForgesToolResult<Commit>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const commit = await provider.commits.get(repoOf(params), { sha: params.sha });
  return result(commit, { platform: params.platform });
}

export async function listCommitChecks(
  args: ListCommitChecksParams,
  options: CallOptions = {},
): Promise<ForgesToolResult<(PageResult<PullRequestCheck> | WaitedCheckPage) & { sha: string }>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const sha = isCommitSha(params.ref) ? params.ref : await commitAt(provider, params);
  const readPage = (cursor: string | undefined) =>
    provider.commits.listChecks(repoOf(params), { ref: sha, cursor, perPage: params.perPage });
  if (params.waitSeconds === undefined) {
    const checks = await readPage(params.cursor);
    return result({ ...checks, sha }, { platform: params.platform });
  }

  const waited = await waitForChecks(readPage, {
    cursor: params.cursor,
    waitSeconds: params.waitSeconds,
    subject: "commit",
    signal: options.signal,
    progress: options.progress,
  });
  return result({ ...waited.page, sha }, { platform: params.platform, note: waited.note });
}

/** Pins a branch or tag to one commit, so its pages and waits share a cursor scope and a push can't swap it. */
async function commitAt(
  provider: Provider,
  params: ListCommitChecksParams & RepositoryTarget,
): Promise<string> {
  const { items } = await provider.commits.list(repoOf(params), { ref: params.ref, perPage: 1 });
  const commit = items[0];
  if (commit === undefined) {
    throw new ForgesError(`No commit found for ref ${quoted(params.ref)}`, {
      status: 404,
      platform: params.platform,
    });
  }
  return commit.sha;
}

export async function readCommitPatch(
  args: ReadCommitPatchParams,
): Promise<ForgesToolResult<CommitPatch>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const patch = await provider.commits.readPatch(repoOf(params), {
    sha: params.sha,
    path: params.path,
    offset: params.offset,
    maxChars: params.maxChars,
  });
  return result(patch, { platform: params.platform });
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
    cursor: params.cursor,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const releases = await provider.releases.list(repoOf(params), options);
  return result(summarizeReleasePage(releases), {
    platform: params.platform,
    note: "Release notes are omitted from list output; use forges_releases_get with the tag to read its notes.",
  });
}

export async function getRelease(
  args: GetReleaseParams,
): Promise<ForgesToolResult<ReleaseNotesSlice>> {
  const params = repositoryTarget(args);
  const notes = { offset: params.offset, maxChars: params.maxChars, notesHash: params.notesHash };
  assertReleaseNotesOptions(notes, params.platform);
  const provider = await readProvider(params.platform);
  const release = await provider.releases.get(repoOf(params), { tag: params.tag });
  return result(sliceReleaseNotes(release, { ...notes, platform: params.platform }), {
    platform: params.platform,
  });
}

export async function createRelease(args: CreateReleaseParams): Promise<ForgesToolResult<Release>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const release = await provider.releases.create(repoOf(params), {
      tag: params.tag,
      name: params.name,
      body: params.body,
      ref: params.ref,
      draft: params.draft,
      prerelease: params.prerelease,
    });
    return result(release, { platform: params.platform });
  });
}

export async function updateRelease(args: UpdateReleaseParams): Promise<ForgesToolResult<Release>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const release = await provider.releases.update(repoOf(params), {
      tag: params.tag,
      name: params.name,
      body: params.body,
      draft: params.draft,
      prerelease: params.prerelease,
    });
    return result(release, { platform: params.platform });
  });
}

export async function listIssues(
  args: ListRepositoryItemsParams,
): Promise<ForgesToolResult<PageResult<Omit<Issue, "body">>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const issues = await provider.issues.list(repoOf(params), listOptions(params));
  return result(summarizeIssuePage(issues), {
    platform: params.platform,
    note: "Issue bodies are omitted from list output; use forges_issues_get to read one body.",
  });
}

export async function searchIssuesGlobal(
  args: SearchIssuesGlobalParams,
): Promise<
  ForgesToolResult<SearchHitPage<GlobalIssueSearchItem> & { resultLimit: number | null }>
> {
  const params = searchTarget(args);
  const chars = bodyPreviewChars(params);
  const provider = await readProvider(params.platform);
  const search = await provider.issues.searchGlobal(params.query ?? "", {
    author: params.author,
    owner: params.owner,
    repo: params.repo,
    state: params.state,
    labels: params.labels,
    cursor: params.cursor,
    perPage: params.perPage,
    sort: params.sort,
    order: params.order,
  });
  return result(
    { ...searchHitPage(search, chars), resultLimit: search.resultLimit },
    {
      platform: params.platform,
      note: searchBodyNote(chars, {
        omitted:
          "Issue bodies are omitted; use forges_issues_get with the hit's repository and number.",
        read: "forges_issues_get with the hit's repository and number",
      }),
    },
  );
}

export async function searchIssues(
  args: SearchRepositoryIssuesParams,
): Promise<ForgesToolResult<SearchHitPage<Issue>>> {
  const params = repositoryTarget(args);
  const chars = bodyPreviewChars(params);
  const provider = await readProvider(params.platform);
  const issues = await provider.issues.search(repoOf(params), {
    query: params.query,
    ...listOptions(params),
  });
  return result(searchHitPage(issues, chars), {
    platform: params.platform,
    note: searchBodyNote(chars, {
      omitted:
        "Issue bodies are omitted from search output; use forges_issues_get to read one body.",
      read: "forges_issues_get",
    }),
  });
}

export async function getIssue(
  args: GetIssueParams,
): Promise<
  ForgesToolResult<ItemBodySlice<Issue> | BatchItem<"number", IssueNumber, ItemBodySlice<Issue>>[]>
> {
  const params = repositoryTarget(args);
  const { platform, number } = params;
  if (Array.isArray(number)) assertBatch({ name: "number", keys: number, platform });
  const window = bodyBatchWindow(params, number);
  const about = itemBody("Issue body", platform);
  assertItemBodyOptions(window, about);
  const provider = await readProvider(platform);
  const read = async (key: IssueNumber) =>
    sliceItemBody(await provider.issues.get(issueOf({ ...params, number: key })), {
      ...window,
      about,
    });
  if (!Array.isArray(number)) return result(await read(number as IssueNumber), { platform });
  return result(await eachItem({ name: "number", keys: number }, read), { platform });
}

/** An empty or oversized batch is a 400 before any request. */
function assertBatch(
  batch: Readonly<{ name: string; keys: readonly unknown[]; platform: ForgesPlatform }>,
): void {
  const { name, keys, platform } = batch;
  if (keys.length === 0 || keys.length > MAX_BATCH_ITEMS) {
    throw new ForgesError(`${name} takes one value or a list of 1 to ${MAX_BATCH_ITEMS}`, {
      status: 400,
      platform,
    });
  }
}

/** One answer per key in input order; writes go one by one, as GitHub asks. */
async function eachItem<Name extends string, Key, T>(
  batch: Readonly<{ name: Name; keys: readonly Key[]; serial?: boolean }>,
  run: (key: Key) => Promise<T>,
): Promise<BatchItem<Name, Key, T>[]> {
  const { name, keys, serial = false } = batch;
  const settled = serial ? await settleInTurn(keys, run) : await Promise.allSettled(keys.map(run));
  return settled.map((outcome, index) => {
    const key = { [name]: keys[index] } as Record<Name, Key>;
    if (outcome.status === "fulfilled") return { ...key, result: outcome.value };
    const failure = toolFailure(outcome.reason);
    if (failure.name === "AbortError") throw failure;
    return { ...key, error: failure.message };
  });
}

/** `Promise.allSettled`, one call at a time. */
async function settleInTurn<Key, T>(
  keys: readonly Key[],
  run: (key: Key) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  const settled: PromiseSettledResult<T>[] = [];
  for (const key of keys) {
    const [outcome] = await Promise.allSettled([run(key)]);
    settled.push(outcome!);
  }
  return settled;
}

/** A batch splits the body ceiling instead of multiplying it. */
function bodyBatchWindow(
  params: Readonly<ItemBodyOptions & { platform: ForgesPlatform }>,
  number: unknown,
): ItemBodyOptions {
  const { offset, maxChars, bodyHash, platform } = params;
  if (!Array.isArray(number)) return { offset, maxChars, bodyHash };
  if ((offset ?? 0) > 0 || bodyHash !== undefined) {
    throw new ForgesError(
      "offset and bodyHash continue one body, so pass the single number they came with",
      { status: 400, platform },
    );
  }
  const share = Math.floor(MAX_WINDOW_CHARS / Math.max(number.length, 1));
  if (maxChars !== undefined && maxChars > share) {
    throw new ForgesError(
      `A batch of ${number.length} bodies holds ${MAX_WINDOW_CHARS} characters in all, so maxChars is at most ${share}`,
      { status: 400, platform },
    );
  }
  return { offset, maxChars: maxChars ?? Math.min(DEFAULT_WINDOW_CHARS, share), bodyHash };
}

function commentListOptions(params: ListCommentsParams): ListCommentOptions {
  return {
    cursor: params.cursor,
    perPage: params.perPage,
  };
}

export async function listIssueComments(
  args: ListCommentsParams,
): Promise<ForgesToolResult<PageResult<Comment>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const comments = await provider.issues.listComments(issueOf(params), commentListOptions(params));
  return result(summarizeCommentPage(comments), {
    platform: params.platform,
    note: "Comment bodies are truncated in list output; use forges_issues_comments_get to read one in full.",
  });
}

export async function getIssueComment(args: GetCommentParams): Promise<ForgesToolResult<Comment>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const comment = await provider.issues.getComment(issueOf(params), {
    commentId: params.commentId,
  });
  return result(comment, { platform: params.platform });
}

export async function createIssueComment(
  args: CreateCommentParams,
): Promise<ForgesToolResult<Comment>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const comment = await provider.issues.createComment(issueOf(params), {
      body: params.body,
    });
    return result(comment, { platform: params.platform });
  });
}

export async function updateIssueComment(
  args: UpdateCommentParams,
): Promise<ForgesToolResult<Comment>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const comment = await provider.issues.updateComment(issueOf(params), {
      commentId: params.commentId,
      body: params.body,
    });
    return result(comment, { platform: params.platform });
  });
}

export async function deleteIssueComment(
  args: DeleteCommentParams,
): Promise<ForgesToolResult<CommentDeletion>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const { commentId } = params;
    await provider.issues.deleteComment(issueOf(params), { commentId });
    return result({ deleted: true, commentId }, { platform: params.platform });
  });
}

function reactionListOptions(params: ListReactionsParams): ListReactionOptions {
  return { commentId: params.commentId, cursor: params.cursor, perPage: params.perPage };
}

export async function listIssueReactions(
  args: ListReactionsParams,
): Promise<ForgesToolResult<PageResult<Reaction>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const reactions = await provider.issues.listReactions(
    issueOf(params),
    reactionListOptions(params),
  );
  return result(reactions, { platform: params.platform });
}

/** Without it a model takes a short filtered page for the end. */
const FILTERED_EVENTS_NOTE =
  "kinds filters each page on its own, so a short or empty page is not the end: follow nextCursor.";

function eventListOptions(params: ListEventsParams): ListEventOptions {
  return { kinds: params.kinds, cursor: params.cursor, perPage: params.perPage };
}

function eventsResult(
  events: PageResult<ThreadEvent>,
  params: Pick<ListEventsParams, "kinds"> & { platform: ForgesPlatform },
): ForgesToolResult<PageResult<ThreadEvent>> {
  const filtered = params.kinds !== undefined && events.nextCursor !== undefined;
  return result(events, {
    platform: params.platform,
    ...(filtered ? { note: FILTERED_EVENTS_NOTE } : {}),
  });
}

export async function listIssueEvents(
  args: ListEventsParams,
): Promise<ForgesToolResult<PageResult<ThreadEvent>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const events = await provider.issues.listEvents(issueOf(params), eventListOptions(params));
  return eventsResult(events, params);
}

export async function listPullRequestEvents(
  args: ListEventsParams,
): Promise<ForgesToolResult<PageResult<ThreadEvent>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const events = await provider.pullRequests.listEvents(issueOf(params), eventListOptions(params));
  return eventsResult(events, params);
}

export async function listSubIssues(
  args: ListSubIssuesParams,
): Promise<ForgesToolResult<PageResult<Omit<SubIssue, "body">>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const subIssues = await provider.issues.listSubIssues(issueOf(params), {
    cursor: params.cursor,
    perPage: params.perPage,
  });
  return result(summarizeIssuePage(subIssues), {
    platform: params.platform,
    note: "Issue bodies are omitted from list output; use forges_issues_get to read one body.",
  });
}

export async function addSubIssue(args: AddSubIssueParams): Promise<ForgesToolResult<Issue>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const parent = await provider.issues.addSubIssue(issueOf(params), {
      subIssue: params.subIssue,
      replaceParent: params.replaceParent,
    });
    return result(parent, { platform: params.platform });
  });
}

export async function removeSubIssue(args: SubIssueParams): Promise<ForgesToolResult<Issue>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const parent = await provider.issues.removeSubIssue(issueOf(params), {
      subIssue: params.subIssue,
    });
    return result(parent, { platform: params.platform });
  });
}

export async function createIssue(args: CreateIssueParams): Promise<ForgesToolResult<Issue>> {
  const params = repositoryTarget(args);
  assertAssignees(params.assignees, params.platform);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const metadata = issueMetadataParams(params);
    const issue = await provider.issues.create(repoOf(params), {
      title: params.title,
      body: params.body,
      labels: params.labels,
      assignees: params.assignees,
      type: metadata.type,
      fields: metadata.fields,
    });
    return result(issue, {
      platform: params.platform,
      note: joinNotes(
        assignmentNote(params.assignees, issue.assignees),
        metadataNote(metadata, { issue, verb: "Creation" }),
      ),
    });
  });
}

export async function listPullRequests(
  args: ListRepositoryItemsParams,
): Promise<ForgesToolResult<PageResult<Omit<PullRequest, "body">>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const pullRequests = await provider.pullRequests.list(repoOf(params), listOptions(params));
  const page = summarizeIssuePage(pullRequests);
  return result(page, {
    platform: params.platform,
    note: "Pull-request bodies are omitted from list output; use forges_pull_requests_get to read one body. A row leaves out the merge commit, time and merger until it is merged, and mergeable or mergeStatus while the list does not report them.",
    modelValue: { ...page, items: page.items.map(pullRequestRowText) },
  });
}

export async function listPullRequestFiles(
  args: ListPullRequestFilesParams,
): Promise<ForgesToolResult<PageResult<PullRequestFile>>> {
  const params = repositoryTarget(args);
  const options: ListPullRequestFilesOptions = {
    cursor: params.cursor,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const files = await provider.pullRequests.listFiles(issueOf(params), options);
  return result(files, { platform: params.platform });
}

export async function listPullRequestChecks(
  args: ListPullRequestChecksParams,
  options: CallOptions = {},
): Promise<ForgesToolResult<CheckPage | WaitedCheckPage>> {
  const params = repositoryTarget(args);
  if (params.headSha?.trim() === "") {
    throw new ForgesError("Checks headSha must not be empty", {
      status: 400,
      platform: params.platform,
    });
  }
  const provider = await readProvider(params.platform);
  const readPage = (cursor: string | undefined) => {
    const options: ListPullRequestChecksOptions = { cursor, perPage: params.perPage };
    return provider.pullRequests.listChecks(issueOf(params), options);
  };
  const readPullRequest = () => provider.pullRequests.get(issueOf(params));
  const expectedHead: ExpectedHead | undefined =
    params.headSha === undefined
      ? undefined
      : { sha: params.headSha, read: async () => (await readPullRequest()).headSha };
  if (params.waitSeconds === undefined) {
    const once = await readChecks(readPage, { cursor: params.cursor, expectedHead });
    return result(once.page, { platform: params.platform, note: once.note });
  }

  const readLastChange = async () => (await readPullRequest()).updatedAt;
  const waited = await waitForChecks(readPage, {
    cursor: params.cursor,
    waitSeconds: params.waitSeconds,
    readLastChange,
    expectedHead,
    signal: options.signal,
    progress: options.progress,
  });
  return result(waited.page, { platform: params.platform, note: waited.note });
}

export async function listPullRequestReviews(
  args: ListPullRequestReviewsParams,
): Promise<ForgesToolResult<PageResult<PullRequestReview>>> {
  const params = repositoryTarget(args);
  const options: ListPullRequestReviewsOptions = {
    cursor: params.cursor,
    perPage: params.perPage,
  };
  const provider = await readProvider(params.platform);
  const reviews = await provider.pullRequests.listReviews(issueOf(params), options);
  return result(summarizeReviewPage(reviews), {
    platform: params.platform,
    note: "Review bodies are truncated in list output; use forges_pull_requests_reviews_get to read one in full on GitHub or Gitea. GitLab entries are reviewer stances, not review bodies. Inline review comments are the threads forges_threads_list reads.",
  });
}

export async function getPullRequestReview(
  args: GetPullRequestReviewParams,
): Promise<ForgesToolResult<PullRequestReview>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const review = await provider.pullRequests.getReview(issueOf(params), {
    reviewId: params.reviewId,
  });
  return result(review, { platform: params.platform });
}

export async function searchPullRequestsGlobal(
  args: SearchPullRequestsGlobalParams,
): Promise<
  ForgesToolResult<SearchHitPage<GlobalPullRequestSearchItem> & { resultLimit: number | null }>
> {
  const params = searchTarget(args);
  const chars = bodyPreviewChars(params);
  const provider = await readProvider(params.platform);
  const search = await provider.pullRequests.searchGlobal(params.query ?? "", {
    author: params.author,
    owner: params.owner,
    repo: params.repo,
    cursor: params.cursor,
    perPage: params.perPage,
    sort: params.sort,
    order: params.order,
  });
  return result(
    { ...searchHitPage(search, chars), resultLimit: search.resultLimit },
    {
      platform: params.platform,
      note: searchBodyNote(chars, {
        omitted:
          "Pull-request bodies and revision details are omitted; use forges_pull_requests_get with the hit's repository and number.",
        read: "forges_pull_requests_get with the hit's repository and number",
      }),
    },
  );
}

export async function searchPullRequests(
  args: SearchRepositoryPullRequestsParams,
): Promise<ForgesToolResult<SearchHitPage<PullRequestSearchItem>>> {
  const params = repositoryTarget(args);
  const chars = bodyPreviewChars(params);
  const provider = await readProvider(params.platform);
  const pullRequests = await provider.pullRequests.search(repoOf(params), {
    query: params.query,
    ...listOptions(params),
  });
  return result(searchHitPage(pullRequests, chars), {
    platform: params.platform,
    note: searchBodyNote(chars, {
      omitted:
        "Pull-request bodies and revision details are omitted from search output; use forges_pull_requests_get to read one in full.",
      read: "forges_pull_requests_get",
    }),
  });
}

export async function getPullRequest(
  args: GetPullRequestParams,
): Promise<
  ForgesToolResult<
    ItemBodySlice<PullRequest> | BatchItem<"number", number, ItemBodySlice<PullRequest>>[]
  >
> {
  const params = repositoryTarget(args);
  const { platform, number } = params;
  if (Array.isArray(number)) assertBatch({ name: "number", keys: number, platform });
  const window = bodyBatchWindow(params, number);
  const about = itemBody("Pull request body", platform);
  assertItemBodyOptions(window, about);
  const provider = await readProvider(platform);
  const read = async (key: number) => {
    const pullRequest = await provider.pullRequests.get(issueOf({ ...params, number: key }), {
      closingIssues: params.closingIssues,
    });
    return sliceItemBody(pullRequest, { ...window, about });
  };
  if (!Array.isArray(number)) return result(await read(number as number), { platform });
  return result(await eachItem({ name: "number", keys: number }, read), { platform });
}

/** A filtered read walks every page itself, so the biggest page costs the fewest requests. */
const DISCUSSION_SCAN_PER_PAGE = 100;

function discussionInputError(message: string, platform: ForgesPlatform): ForgesError {
  return new ForgesError(message, { status: 400, platform });
}

/** Checks a filter or a wait before any request; such a call reads every page, so no cursor. */
function assertDiscussionRead(
  params: Readonly<{
    platform: ForgesPlatform;
    cursor?: string;
    since?: string;
    waitSeconds?: number;
  }>,
  texts: Readonly<Record<string, string | undefined>>,
): boolean {
  const { platform, cursor, since, waitSeconds } = params;
  for (const [name, value] of Object.entries(texts)) {
    if (value?.trim() === "") throw discussionInputError(`${name} must not be empty`, platform);
  }
  if (since !== undefined && Number.isNaN(Date.parse(since))) {
    throw discussionInputError("since must be an ISO 8601 date", platform);
  }
  if (
    waitSeconds !== undefined &&
    (!Number.isInteger(waitSeconds) || waitSeconds < 1 || waitSeconds > MAX_WAIT_SECONDS)
  ) {
    throw discussionInputError(
      `waitSeconds must be a whole number from 1 to ${MAX_WAIT_SECONDS}`,
      platform,
    );
  }
  const names = [...Object.keys(texts), "since", "waitSeconds"];
  const given = { ...texts, since, waitSeconds };
  const filtered = Object.values(given).some((value) => value !== undefined);
  if (filtered && cursor !== undefined) {
    throw discussionInputError(
      `${names.join(", ")} read every page themselves, so they take no cursor; drop it`,
      platform,
    );
  }
  return filtered;
}

const PULL_REQUEST_COMMENT_TRUNCATION_NOTE =
  "Comment bodies are truncated in list output; use forges_pull_requests_comments_get to read one in full.";

export async function listPullRequestComments(
  args: ListPullRequestCommentsParams,
  options: CallOptions = {},
): Promise<ForgesToolResult<PageResult<Comment> & { wait?: DiscussionWait }>> {
  const params = repositoryTarget(args);
  const { marker, since, waitSeconds } = params;
  const filtered = assertDiscussionRead(params, { marker });
  const provider = await readProvider(params.platform);
  if (!filtered) {
    const comments = await provider.pullRequests.listComments(
      issueOf(params),
      commentListOptions(params),
    );
    return result(summarizeCommentPage(comments), {
      platform: params.platform,
      note: PULL_REQUEST_COMMENT_TRUNCATION_NOTE,
    });
  }

  const perPage = params.perPage ?? DISCUSSION_SCAN_PER_PAGE;
  const readPage = (cursor: string | undefined) =>
    provider.pullRequests.listComments(issueOf(params), { cursor, perPage, since });
  const answer = await readComments(readPage, {
    marker,
    since,
    waitSeconds,
    signal: options.signal,
    progress: options.progress,
  });
  return result(summarizeCommentPage(answer.page), {
    platform: params.platform,
    note: joinNotes(answer.note, PULL_REQUEST_COMMENT_TRUNCATION_NOTE),
  });
}

export async function getPullRequestComment(
  args: GetCommentParams,
): Promise<ForgesToolResult<Comment>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const comment = await provider.pullRequests.getComment(issueOf(params), {
    commentId: params.commentId,
  });
  return result(comment, { platform: params.platform });
}

export async function createPullRequestComment(
  args: CreateCommentParams,
): Promise<ForgesToolResult<Comment>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const comment = await provider.pullRequests.createComment(issueOf(params), {
      body: params.body,
    });
    return result(comment, { platform: params.platform });
  });
}

export async function updatePullRequestComment(
  args: UpdateCommentParams,
): Promise<ForgesToolResult<Comment>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const comment = await provider.pullRequests.updateComment(issueOf(params), {
      commentId: params.commentId,
      body: params.body,
    });
    return result(comment, { platform: params.platform });
  });
}

export async function deletePullRequestComment(
  args: DeleteCommentParams,
): Promise<ForgesToolResult<CommentDeletion>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const { commentId } = params;
    await provider.pullRequests.deleteComment(issueOf(params), { commentId });
    return result({ deleted: true, commentId }, { platform: params.platform });
  });
}

export async function listPullRequestReactions(
  args: ListPullRequestReactionsParams,
  options: CallOptions = {},
): Promise<ForgesToolResult<PageResult<Reaction> & { wait?: ReactionWait }>> {
  const params = repositoryTarget(args);
  const { author, since, waitSeconds } = params;
  const filtered = assertDiscussionRead(params, { author });
  const provider = await readProvider(params.platform);
  if (!filtered) {
    const reactions = await provider.pullRequests.listReactions(
      issueOf(params),
      reactionListOptions(params),
    );
    return result(reactions, { platform: params.platform });
  }

  const perPage = params.perPage ?? DISCUSSION_SCAN_PER_PAGE;
  const readPage = (cursor: string | undefined) =>
    provider.pullRequests.listReactions(issueOf(params), {
      commentId: params.commentId,
      cursor,
      perPage,
    });
  const answer = await readReactions(readPage, {
    author,
    since,
    waitSeconds,
    signal: options.signal,
    progress: options.progress,
  });
  return result(answer.page, { platform: params.platform, note: answer.note });
}

export async function createPullRequest(
  args: CreatePullRequestParams,
): Promise<ForgesToolResult<PullRequest>> {
  const params = repositoryTarget(args);
  assertAssignees(params.assignees, params.platform);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const pullRequest = await provider.pullRequests.create(repoOf(params), {
      title: params.title,
      body: params.body,
      sourceBranch: params.sourceBranch,
      targetBranch: params.targetBranch,
      draft: params.draft,
      assignees: params.assignees,
    });
    const { assignmentError, ...created } = pullRequest;
    const reason = assignmentError === undefined ? undefined : withoutEndpoint(assignmentError);
    return result(reason === undefined ? created : { ...created, assignmentError: reason }, {
      platform: params.platform,
      note: assignmentNote(params.assignees, pullRequest.assignees, reason),
      modelValue: created,
    });
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
    ...issueMetadataParams(params),
  };
  assertIssueUpdate(input, params.platform);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const issue = await provider.issues.update(issueOf(params), input);
    return result(issue, {
      platform: params.platform,
      note: joinNotes(
        reassignmentNote(input, issue.assignees),
        metadataNote(input, { issue, verb: "Update" }),
      ),
    });
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
    const pullRequest = await provider.pullRequests.update(issueOf(params), input);
    return result(pullRequest, {
      platform: params.platform,
      note: reassignmentNote(input, pullRequest.assignees),
    });
  });
}

export async function mergePullRequest(
  args: MergePullRequestParams,
): Promise<ForgesToolResult<PullRequest>> {
  const params = repositoryTarget(args);
  const input: MergePullRequestInput = {
    method: params.method,
    headSha: params.headSha,
    title: params.title,
    message: params.message,
  };
  assertMergeInput(input, params.platform);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const pullRequest = await provider.pullRequests.merge(issueOf(params), input);
    return result(pullRequest, { platform: params.platform });
  });
}

export async function getUser(args: GetUserParams): Promise<ForgesToolResult<User>> {
  const params = platformTarget(args);
  const provider = await readProvider(params.platform);
  const user = await provider.users.get(params.username);
  return result(user, { platform: params.platform });
}

export type AuthenticatedUserParams = PlatformParams & AccountParams;

async function authenticatedUserResult(
  platform: ForgesPlatform,
  account: string | undefined,
): Promise<ForgesToolResult<User>> {
  const provider = await authenticatedProvider(platform, account);
  return result(await provider.users.authenticated(), { platform });
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
  cursor?: string;
  perPage?: number;
  state?: ThreadState;
}

export interface GetThreadParams extends RepositoryParams {
  number: number;
  threadId: OneOrBatch<string>;
}

export type ThreadStateParams = GetThreadParams & AccountParams;

/** Replies, edits and deletes name one thread. */
type OneThreadParams = Omit<ThreadStateParams, "threadId"> & { threadId: string };

export type ReplyThreadParams = OneThreadParams & ReplyThreadInput;

export type UpdateThreadCommentParams = ReplyThreadParams & { commentId: string };

export type DeleteThreadCommentParams = OneThreadParams & { commentId: string };

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
    cursor: params.cursor,
    perPage: params.perPage,
    state: params.state,
  };
}

export async function listThreads(
  args: ListThreadsParams,
): Promise<ForgesToolResult<PageResult<Thread>>> {
  const params = repositoryTarget(args);
  const provider = await readProvider(params.platform);
  const threads = await provider.threads.list(issueOf(params), threadListOptions(params));
  return result(summarizeThreadPage(threads), {
    platform: params.platform,
    note: "Comment bodies are truncated in list output; use forges_threads_get to read one full thread.",
  });
}

export async function getThread(
  args: GetThreadParams,
): Promise<ForgesToolResult<Thread | BatchItem<"threadId", string, Thread>[]>> {
  const params = repositoryTarget(args);
  const { platform, threadId } = params;
  if (Array.isArray(threadId)) assertBatch({ name: "threadId", keys: threadId, platform });
  const provider = await readProvider(platform);
  const read = (id: string) => provider.threads.get(issueOf(params), { threadId: id });
  if (!Array.isArray(threadId)) return result(await read(threadId as string), { platform });
  return result(await eachItem({ name: "threadId", keys: threadId }, read), {
    platform,
  });
}

export async function replyToThread(
  args: ReplyThreadParams,
): Promise<ForgesToolResult<ThreadComment>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const comment = await provider.threads.reply(issueOf(params), {
      threadId: params.threadId,
      body: params.body,
    });
    return result(comment, { platform: params.platform });
  });
}

export async function updateThreadComment(
  args: UpdateThreadCommentParams,
): Promise<ForgesToolResult<ThreadComment>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const comment = await provider.threads.updateComment(issueOf(params), {
      threadId: params.threadId,
      commentId: params.commentId,
      body: params.body,
    });
    return result(comment, { platform: params.platform });
  });
}

export async function deleteThreadComment(
  args: DeleteThreadCommentParams,
): Promise<ForgesToolResult<CommentDeletion>> {
  const params = repositoryTarget(args);
  return withCredentialOperation(params.platform, async () => {
    const provider = await authenticatedProvider(params.platform, params.account);
    const { threadId, commentId } = params;
    await provider.threads.deleteComment(issueOf(params), { threadId, commentId });
    return result({ deleted: true, commentId }, { platform: params.platform });
  });
}

type ThreadStateRow = Omit<Thread, "comments"> & { commentCount: number };

/** A state change flips one flag and leaves the comments alone, so the model gets just a count. */
function threadStateText({ comments, ...thread }: Thread): ThreadStateRow {
  return { ...thread, commentCount: comments.length };
}

type ThreadStateAnswer = ForgesToolResult<Thread | BatchItem<"threadId", string, Thread>[]>;

/** Resolve or reopen one thread or a batch under one credential. */
async function setThreadState(
  args: ThreadStateParams,
  change: "resolve" | "unresolve",
): Promise<ThreadStateAnswer> {
  const params = repositoryTarget(args);
  const { platform, threadId } = params;
  if (Array.isArray(threadId)) assertBatch({ name: "threadId", keys: threadId, platform });
  return withCredentialOperation(platform, async () => {
    const provider = await authenticatedProvider(platform, params.account);
    const write = (id: string) => provider.threads[change](issueOf(params), { threadId: id });
    if (!Array.isArray(threadId)) {
      const thread = await write(threadId as string);
      return result(thread, { platform, modelValue: threadStateText(thread) });
    }
    const items = await eachItem({ name: "threadId", keys: threadId, serial: true }, write);
    const modelValue = items.map((item) =>
      "result" in item ? { threadId: item.threadId, result: threadStateText(item.result) } : item,
    );
    return result(items, { platform, modelValue });
  });
}

export async function resolveThread(args: ThreadStateParams): Promise<ThreadStateAnswer> {
  return setThreadState(args, "resolve");
}

export async function unresolveThread(args: ThreadStateParams): Promise<ThreadStateAnswer> {
  return setThreadState(args, "unresolve");
}

/** Concurrent calls share one import: uncached jiti hands an overlapping one an empty namespace. */
const loadLocal = /* @__PURE__ */ lazy(() => import("./local.ts"));

export async function verifyLocalMerge(
  params: VerifyLocalMergeOptions,
): Promise<ForgesToolResult<LocalMergeVerification>> {
  const local = await loadLocal();
  return result(await local.verifyLocalMerge(params), { platform: "local" });
}

export async function inspectLocal(
  params: InspectLocalOptions,
): Promise<ForgesToolResult<LocalInspection>> {
  const local = await loadLocal();
  return result(await local.inspectLocal(params), { platform: "local" });
}

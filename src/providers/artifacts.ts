/**
 * Cloudflare Artifacts provider implementation
 * Git storage behind the Cloudflare v4 REST API, with key differences:
 * - Base path: /accounts/:account/artifacts/namespaces/:namespace, the namespace playing owner
 * - Bearer token, resolved again for every request because a cf CLI session expires
 * - JSON comes in the v4 envelope, file reads answer with raw bytes
 * - Repositories page by cursor, the commit log by offset
 * - No collaboration layer: issues, pull requests, users and threads answer 501
 */

import type { CloudflareCredential } from "@agntn/credentials/cloudflare";
import { resolveCloudflareCredential } from "../auth.ts";
import { createHttpClient, type HttpClient } from "../http.ts";
import { cursorPage } from "../pagination.ts";
import { FetchError, ForgesError, NotFoundError, normalizeError } from "../errors.ts";
import {
  encodeApiResponsePathSegment,
  encodePathSegment,
  normalizeApiBaseURL,
} from "./base-url.ts";
import { Provider, type ProviderRawTypes } from "../provider.ts";
import {
  assertContinuationRef,
  buildRepositoryFileFromBytes,
  isCommitSha,
  unreadableEntry,
} from "../repository-contents.ts";
import type {
  Comment,
  Commit,
  CommitIdentity,
  CommitSummary,
  CreateIssueInput,
  CreatePullRequestInput,
  Issue,
  ListCommentOptions,
  ListCommitOptions,
  ListOptions,
  ListThreadOptions,
  Owner,
  PageResult,
  PullRequest,
  ReplyThreadInput,
  Repository,
  RepositoryContents,
  RepositoryContentsOptions,
  RepositoryEntry,
  ProviderConfig,
  Thread,
  ThreadComment,
  User,
} from "../types.ts";

const PLATFORM = "artifacts";
const DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";
/** The repository list takes at most 200 per request. */
const REPOSITORY_CHUNK = 200;
/** The commit log takes at most 1000 per request, one of them the row past the page. */
const LOG_LIMIT = 1000;

interface ArtifactsEnvelope<T> {
  result: T;
  result_info?: { cursor?: string };
}

interface ArtifactsRepository {
  id: string;
  name: string;
  description: string | null;
  default_branch: string;
  /** `artifacts:<namespace>/<repo>` for a fork, null for a repository made here. */
  source: string | null;
  remote: string;
}

interface ArtifactsCommit {
  hash: string;
  treeHash: string;
  message: string;
  author: { name: string; email: string };
  committer: { name: string; email: string };
  parents: string[];
  /** Unix seconds. */
  authoredAt: number;
  committedAt: number;
}

interface ArtifactsTreeEntry {
  name: string;
  hash: string;
  type: "tree" | "blob" | "symlink" | "gitlink" | "exec";
}

/** A repository with the account URL its links hang off. */
interface ArtifactsRepositoryRecord {
  accountURL: string;
  namespace: string;
  repository: ArtifactsRepository;
}

interface ArtifactsRawTypes extends ProviderRawTypes {
  owner: string;
  repository: ArtifactsRepositoryRecord;
  issue: never;
  pullRequest: never;
  user: never;
  thread: never;
  comment: never;
}

/** Artifacts keeps Git data only, so the forge side of the contract answers 501. */
function missing(feature: string): Promise<never> {
  return Promise.reject(new ForgesError(`Cloudflare Artifacts has no ${feature}`, 501, PLATFORM));
}

function repositoryURL(accountURL: string, namespace: string, repo: string): string {
  return `${accountURL}/namespaces/${encodeURIComponent(namespace)}/repos/${encodeURIComponent(repo)}`;
}

/** Unix seconds as ISO 8601, or empty when the API sent no usable time. */
function isoFromSeconds(seconds: number): string {
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function mapIdentity(identity: { name: string; email: string }, seconds: number): CommitIdentity {
  return { name: identity.name, email: identity.email, date: isoFromSeconds(seconds) };
}

function entryType(type: ArtifactsTreeEntry["type"]): RepositoryEntry["type"] {
  if (type === "tree") return "directory";
  if (type === "symlink") return "symlink";
  if (type === "gitlink") return "submodule";
  return "file";
}

export class ArtifactsProvider extends Provider<ArtifactsRawTypes> {
  private readonly apiBaseURL: string;
  private readonly token: string | undefined;
  private readonly accountId: string | undefined;
  private client: HttpClient | undefined;
  private clientKey: string | undefined;

  /**
   * Create a Cloudflare Artifacts provider.
   *
   * @param config Provider configuration. `baseURL` defaults to
   * `https://api.cloudflare.com/client/v4`. Without `token` and `accountId`,
   * every request takes them from `@agntn/credentials`: `CLOUDFLARE_API_TOKEN`
   * and `CLOUDFLARE_ACCOUNT_ID`, then the cf CLI session.
   */
  constructor(config: ProviderConfig) {
    super();
    this.apiBaseURL = normalizeApiBaseURL(config.baseURL, DEFAULT_BASE_URL, "/client/v4");
    this.token = config.token === "" ? undefined : config.token;
    this.accountId = config.accountId;
  }

  protected override mapOwner(raw: string): Owner {
    return { login: raw, avatarUrl: "" };
  }

  protected override mapRepository(raw: ArtifactsRepositoryRecord): Repository {
    const { accountURL, namespace, repository } = raw;
    const parent = repository.source?.startsWith("artifacts:")
      ? repository.source.slice("artifacts:".length)
      : null;
    const [parentNamespace, parentName] = parent?.split("/") ?? [];
    return {
      id: String(repository.id),
      name: repository.name,
      fullName: `${namespace}/${repository.name}`,
      description: repository.description ?? "",
      private: true,
      defaultBranch: repository.default_branch,
      url: repositoryURL(accountURL, namespace, repository.name),
      cloneUrl: repository.remote,
      isFork: parent !== null,
      parent:
        parent === null
          ? null
          : {
              fullName: parent,
              url:
                parentNamespace && parentName
                  ? repositoryURL(accountURL, parentNamespace, parentName)
                  : "",
            },
      viewerPermission: null,
      owner: this.mapOwner(namespace),
    };
  }

  protected override mapIssue(raw: never): Issue {
    return raw;
  }

  protected override mapPullRequest(raw: never): PullRequest {
    return raw;
  }

  protected override mapUser(raw: never): User {
    return raw;
  }

  protected override mapThread(raw: never): Thread {
    return raw;
  }

  protected override mapComment(raw: never): Comment {
    return raw;
  }

  protected override async listRepos(
    owner: string,
    options?: ListOptions,
  ): Promise<PageResult<Repository>> {
    try {
      const page = await cursorPage<ArtifactsRepository>(
        async (limit, cursor) => {
          const response = await this.withCredential((client) =>
            client<ArtifactsEnvelope<ArtifactsRepository[]>>(`${this.namespacePath(owner)}/repos`, {
              query: { limit, cursor },
            }),
          );
          return { items: response.result, cursor: response.result_info?.cursor };
        },
        options?.page,
        options?.perPage,
        REPOSITORY_CHUNK,
      );
      const accountURL = await this.accountURL();
      return {
        ...page,
        items: page.items.map((repository) =>
          this.mapRepository({ accountURL, namespace: owner, repository }),
        ),
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getRepo(owner: string, repo: string): Promise<Repository> {
    try {
      const response = await this.withCredential((client) =>
        client<ArtifactsEnvelope<ArtifactsRepository>>(this.repoPath(owner, repo)),
      );
      return this.mapRepository({
        accountURL: await this.accountURL(),
        namespace: owner,
        repository: response.result,
      });
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async readRepositoryContents(
    owner: string,
    repo: string,
    path: string,
    options?: RepositoryContentsOptions,
  ): Promise<RepositoryContents> {
    try {
      const route = this.repoPath(owner, repo);
      const commit = await this.resolveCommit(owner, repo, options?.ref);
      assertContinuationRef(options, commit.hash);
      if (path !== "") {
        const file = await this.readFile(route, commit.hash, path);
        if (file !== null) {
          return buildRepositoryFileFromBytes(path, commit.hash, file, options);
        }
      }
      const tree = await this.walkTree(route, commit.treeHash, path);
      return {
        type: "directory",
        path,
        sha: commit.hash,
        entries: tree.map((entry) => ({
          name: entry.name,
          path: path === "" ? entry.name : `${path}/${entry.name}`,
          type: entryType(entry.type),
          size: null,
        })),
        entriesComplete: true,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async listCommits(
    owner: string,
    repo: string,
    options?: ListCommitOptions,
  ): Promise<PageResult<CommitSummary>> {
    if (
      options?.path !== undefined ||
      options?.since !== undefined ||
      options?.until !== undefined
    ) {
      return Promise.reject(
        new ForgesError(
          "Cloudflare Artifacts reads the log by ref only. Drop path, since and until",
          501,
          PLATFORM,
        ),
      );
    }
    const page = options?.page ?? 1;
    const perPage = options?.perPage ?? 30;
    try {
      const commits = await this.log(owner, repo, options?.ref, (page - 1) * perPage, perPage + 1);
      if (commits.length === 0 && page === 1 && options?.ref !== undefined) {
        throw new NotFoundError(`No commits at ref ${options.ref}`, PLATFORM);
      }
      const hasNextPage = commits.length > perPage;
      const url = repositoryURL(await this.accountURL(), owner, repo);
      return {
        items: commits.slice(0, perPage).map((commit) => this.mapCommit(url, commit)),
        hasNextPage,
        nextPage: hasNextPage ? page + 1 : undefined,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getCommit(owner: string, repo: string, sha: string): Promise<Commit> {
    try {
      const commit = await this.resolveCommit(owner, repo, sha);
      return {
        ...this.mapCommit(repositoryURL(await this.accountURL(), owner, repo), commit),
        files: [],
        filesComplete: null,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override listIssues(): Promise<PageResult<Issue>> {
    return missing("issues");
  }

  protected override getIssue(): Promise<Issue> {
    return missing("issues");
  }

  protected override createIssue(
    _owner: string,
    _repo: string,
    _input: CreateIssueInput,
  ): Promise<Issue> {
    return missing("issues");
  }

  protected override listPullRequests(): Promise<PageResult<PullRequest>> {
    return missing("pull requests");
  }

  protected override getPullRequest(): Promise<PullRequest> {
    return missing("pull requests");
  }

  protected override createPullRequest(
    _owner: string,
    _repo: string,
    _input: CreatePullRequestInput,
  ): Promise<PullRequest> {
    return missing("pull requests");
  }

  protected override listIssueComments(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: ListCommentOptions,
  ): Promise<PageResult<Comment>> {
    return missing("comments");
  }

  protected override listPullRequestComments(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: ListCommentOptions,
  ): Promise<PageResult<Comment>> {
    return missing("comments");
  }

  protected override getIssueComment(): Promise<Comment> {
    return missing("comments");
  }

  protected override getPullRequestComment(): Promise<Comment> {
    return missing("comments");
  }

  protected override getUser(): Promise<User> {
    return missing("users");
  }

  protected override getAuthenticatedUser(): Promise<User> {
    return missing("users");
  }

  protected override listThreads(
    _owner: string,
    _repo: string,
    _number: number,
    _options?: ListThreadOptions,
  ): Promise<PageResult<Thread>> {
    return missing("review threads");
  }

  protected override getThread(): Promise<Thread> {
    return missing("review threads");
  }

  protected override replyToThread(
    _owner: string,
    _repo: string,
    _number: number,
    _threadId: string,
    _input: ReplyThreadInput,
  ): Promise<ThreadComment> {
    return missing("review threads");
  }

  protected override resolveThread(): Promise<Thread> {
    return missing("review threads");
  }

  protected override unresolveThread(): Promise<Thread> {
    return missing("review threads");
  }

  private mapCommit(repoURL: string, raw: ArtifactsCommit): CommitSummary {
    return {
      sha: raw.hash,
      message: raw.message,
      author: mapIdentity(raw.author, raw.authoredAt),
      committer: mapIdentity(raw.committer, raw.committedAt),
      parents: raw.parents,
      url: `${repoURL}/commit/${raw.hash}`,
    };
  }

  /** A full SHA-1 is read as it is. A branch, a tag or no ref at all goes through the log. */
  private async resolveCommit(
    owner: string,
    repo: string,
    ref: string | undefined,
  ): Promise<ArtifactsCommit> {
    if (isCommitSha(ref)) {
      const response = await this.withCredential((client) =>
        client<ArtifactsEnvelope<ArtifactsCommit>>(`${this.repoPath(owner, repo)}/commit/${ref}`),
      );
      return response.result;
    }
    const [commit] = await this.log(owner, repo, ref, 0, 1);
    if (commit === undefined) {
      throw new NotFoundError(
        ref === undefined ? "The repository has no commits yet" : `No commits at ref ${ref}`,
        PLATFORM,
      );
    }
    return commit;
  }

  /** An unknown ref, `HEAD` included, gets an empty log, so `HEAD` goes out as no ref. */
  private async log(
    owner: string,
    repo: string,
    ref: string | undefined,
    offset: number,
    limit: number,
  ): Promise<ArtifactsCommit[]> {
    if (limit > LOG_LIMIT) {
      throw new ForgesError(
        `Cloudflare Artifacts reads at most ${LOG_LIMIT - 1} commits a page`,
        400,
        PLATFORM,
      );
    }
    const response = await this.withCredential((client) =>
      client<ArtifactsEnvelope<ArtifactsCommit[]>>(`${this.repoPath(owner, repo)}/log`, {
        query: { ref: ref === "HEAD" ? undefined : ref, offset, limit },
      }),
    );
    return response.result;
  }

  /** The file route answers 404 for a directory too, so null sends the caller to the tree. */
  private async readFile(route: string, sha: string, path: string): Promise<Uint8Array | null> {
    try {
      const bytes = await this.withCredential((client) =>
        client(`${route}/file`, { query: { ref: sha, path }, responseType: "arrayBuffer" }),
      );
      return new Uint8Array(bytes);
    } catch (error) {
      if (error instanceof FetchError && error.status === 404) return null;
      throw error;
    }
  }

  /** Follow a path down the trees, one request per directory. Only the last step may be a file. */
  private async walkTree(
    route: string,
    rootHash: string,
    path: string,
  ): Promise<ArtifactsTreeEntry[]> {
    let entries = await this.readTree(route, rootHash);
    if (path === "") return entries;
    const segments = path.split("/");
    for (const [index, segment] of segments.entries()) {
      const entry = entries.find((candidate) => candidate.name === segment);
      if (entry === undefined || (entry.type !== "tree" && index < segments.length - 1)) {
        throw new NotFoundError(`Repository path not found: ${path}`, PLATFORM);
      }
      if (entry.type !== "tree") throw unreadableEntry(path, entry.type);
      entries = await this.readTree(route, entry.hash);
    }
    return entries;
  }

  private async readTree(route: string, hash: string): Promise<ArtifactsTreeEntry[]> {
    const response = await this.withCredential((client) =>
      client<ArtifactsEnvelope<ArtifactsTreeEntry[]>>(
        `${route}/tree/${encodeApiResponsePathSegment(hash)}`,
      ),
    );
    return response.result;
  }

  private namespacePath(namespace: string): string {
    return `/namespaces/${encodePathSegment(namespace)}`;
  }

  private repoPath(namespace: string, repo: string): string {
    return `${this.namespacePath(namespace)}/repos/${encodePathSegment(repo)}`;
  }

  private async accountURL(): Promise<string> {
    return this.accountBase((await this.credential()).accountId);
  }

  private accountBase(accountId: string): string {
    return `${this.apiBaseURL.replace(/\/+$/u, "")}/accounts/${encodePathSegment(accountId)}/artifacts`;
  }

  private credential(refresh = false): Promise<CloudflareCredential> {
    return resolveCloudflareCredential({ token: this.token, accountId: this.accountId, refresh });
  }

  /** One request under the account path, sent again once after a 401 on a cf session token. */
  private async withCredential<T>(send: (client: HttpClient) => Promise<T>): Promise<T> {
    const credential = await this.credential();
    try {
      return await send(this.clientFor(credential));
    } catch (error) {
      if (credential.source !== "cli" || !(error instanceof FetchError) || error.status !== 401) {
        throw error;
      }
      return send(this.clientFor(await this.credential(true)));
    }
  }

  /** One client per token and account, rebuilt when a cf session token rolls over. */
  private clientFor(credential: CloudflareCredential): HttpClient {
    const baseURL = this.accountBase(credential.accountId);
    const key = `${baseURL}\n${credential.token}`;
    if (this.client === undefined || this.clientKey !== key) {
      this.client = createHttpClient({
        baseURL,
        token: credential.token,
        tokenHeader: "Authorization",
        tokenPrefix: "Bearer ",
      });
      this.clientKey = key;
    }
    return this.client;
  }
}

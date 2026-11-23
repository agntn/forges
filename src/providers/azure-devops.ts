/**
 * Azure DevOps provider implementation
 * REST 7.1 on dev.azure.com, built on `forges/azure-devops`, with key differences:
 * - The owner is `organization/project`, since a repository lives in a project
 * - Issues are work items, numbered across the whole project
 * - A pull request comment is `<thread>/<comment>`
 * - The commit log pages on `$top` and `$skip` and sends no total
 */

import type { ForgeProvider as Forge, RepoRef as ForgeRepoRef } from "forges";
import { azureDevOps } from "forges/azure-devops";

import { ForgeBackedProvider, type ForgeOptions } from "./forge.ts";
import { changedFileFromModel } from "./forge-model.ts";
import { encodePathSegment } from "./base-url.ts";
import { ForgesError, NotFoundError, normalizeError } from "../errors.ts";
import { assertProviderConfig } from "../provider-config.ts";
import {
  assertContinuationRef,
  assertFileSize,
  buildRepositoryFileFromBytes,
  isCommitSha,
} from "../repository-contents.ts";
import { slicePage } from "../pagination.ts";
import type { ContinuedPage, Numbered, NumberedPage, Positioned, WithPage } from "../provider.ts";
import type {
  CiJob,
  CiRun,
  CommitComparison,
  CommitIdentity,
  CommitSummary,
  CompareCommitsOptions,
  ListCiJobsOptions,
  ListCiRunsOptions,
  ListCommitOptions,
  IssueRef,
  ListOptions,
  ListReleasesOptions,
  ListThreadOptions,
  ProviderConfig,
  Release,
  RepoRef,
  Repository,
  RepositoryContents,
  RepositoryContentsOptions,
  RepositoryEntry,
  ReplyThreadInput,
  Thread,
  ThreadComment,
} from "../types.ts";

const PLATFORM = "azure-devops";

const SERVICE = "https://dev.azure.com";

/** Most commits one comparison lists. */
const MAX_RANGE = 1000;

/** One `/items` row; the scope path itself comes first. */
interface AzureItem {
  path: string;
  gitObjectType?: "blob" | "tree" | "commit";
  isFolder?: boolean;
  objectId?: string;
}

/** One commit of the log, as `/commits` sends it. */
interface AzureCommit {
  commitId: string;
  comment?: string;
  author?: AzureSignature;
  committer?: AzureSignature;
  parents?: string[];
  remoteUrl?: string;
}

interface AzureSignature {
  name?: string;
  email?: string | null;
  date?: string;
}

/** A pull request thread; one with a file path is a review thread. */
interface AzureThread {
  id: number;
  status?: string;
  isDeleted?: boolean;
  threadContext?: {
    filePath?: string;
    rightFileStart?: { line?: number };
    rightFileEnd?: { line?: number };
    leftFileStart?: { line?: number };
    leftFileEnd?: { line?: number };
  } | null;
  comments: AzureComment[];
}

interface AzureComment {
  id: number;
  content?: string;
  commentType?: string;
  isDeleted?: boolean;
  publishedDate?: string;
  author?: { uniqueName?: string | null; displayName?: string; id?: string };
}

/** Thread statuses still waiting on someone; the rest read as resolved. */
const OPEN_THREAD = new Set(["active", "pending"]);

/** What Azure DevOps doesn't have, as the refusal names it. */
function missing(feature: string): Promise<never> {
  return Promise.reject(
    new ForgesError(`Azure DevOps has no ${feature}`, { status: 501, platform: PLATFORM }),
  );
}

/** `https://dev.azure.com/acme` and `https://acme.visualstudio.com` both name `acme`. */
export function organizationOf(url: string | undefined): string | undefined {
  const parsed = url === undefined ? null : URL.parse(url);
  if (parsed === null) return undefined;
  if (parsed.hostname === "dev.azure.com") {
    return parsed.pathname.split("/").find((segment) => segment !== "");
  }
  const suffix = ".visualstudio.com";
  return parsed.hostname.endsWith(suffix) ? parsed.hostname.slice(0, -suffix.length) : undefined;
}

/** A sha, a `refs/tags/` tag, else a branch, as Azure DevOps types a version. */
function itemVersion(ref: string): Record<string, string> {
  if (ref.startsWith("refs/tags/")) return { version: ref.slice(10), versionType: "tag" };
  const versionType = isCommitSha(ref) ? "commit" : "branch";
  return { version: ref.replace(/^refs\/heads\//u, ""), versionType };
}

/** Dates in the shape `commits.get` already gives. */
function identity(who: AzureSignature | undefined): CommitIdentity {
  const time = who?.date === undefined ? Number.NaN : Date.parse(who.date);
  return {
    name: who?.name ?? "",
    email: who?.email ?? "",
    date: Number.isNaN(time) ? "" : new Date(time).toISOString(),
  };
}

function commitOf(raw: AzureCommit): CommitSummary {
  return {
    sha: raw.commitId,
    message: raw.comment ?? "",
    author: identity(raw.author),
    committer: identity(raw.committer),
    parents: raw.parents ?? [],
    url: raw.remoteUrl ?? "",
  };
}

/** The account name, else the display name. */
function login(author: AzureComment["author"]): string {
  return author?.uniqueName ?? author?.displayName ?? author?.id ?? "";
}

/** A thread on a file, or nothing for a conversation one. */
function reviewThread(raw: AzureThread, web: string): Thread | undefined {
  const context = raw.threadContext;
  const path = context?.filePath;
  if (path === undefined || raw.isDeleted === true) return undefined;
  const comments = raw.comments.filter(
    (comment) => comment.isDeleted !== true && comment.commentType !== "system",
  );
  if (comments.length === 0) return undefined;
  const start = context?.rightFileStart?.line ?? context?.leftFileStart?.line ?? null;
  const end = context?.rightFileEnd?.line ?? context?.leftFileEnd?.line ?? start;
  return {
    id: String(raw.id),
    isResolved: !OPEN_THREAD.has(raw.status ?? ""),
    isOutdated: false,
    path: path.replace(/^\/+/u, ""),
    line: end,
    startLine: start === end ? null : start,
    comments: comments.map((comment) => threadComment(comment, `${web}?discussionId=${raw.id}`)),
  };
}

function threadComment(raw: AzureComment, url: string): ThreadComment {
  return {
    id: String(raw.id),
    body: raw.content ?? "",
    author: { login: login(raw.author) },
    url,
    createdAt: raw.publishedDate ?? "",
  };
}

function entryOf(item: AzureItem): RepositoryEntry {
  const path = item.path.replace(/^\/+/u, "");
  const type =
    item.isFolder === true || item.gitObjectType === "tree"
      ? "directory"
      : item.gitObjectType === "commit"
        ? "submodule"
        : "file";
  return { name: path.slice(path.lastIndexOf("/") + 1), path, type, size: null };
}

/** Azure DevOps Services, where work items stand in for issues and releases answer 501. */
export class AzureDevOpsProvider extends ForgeBackedProvider {
  readonly #organization: string | undefined;

  /**
   * Create an Azure DevOps provider.
   *
   * @param config Provider configuration. `baseURL` names the organization.
   */
  constructor(config: ProviderConfig) {
    assertProviderConfig(config, PLATFORM);
    super(PLATFORM, { apiBaseURL: SERVICE, token: config.token ?? "" });
    this.#organization = organizationOf(config.baseURL);
    if (config.baseURL && this.#organization === undefined) {
      throw new ForgesError(
        "baseURL must be https://dev.azure.com/<organization> or https://<organization>.visualstudio.com; Azure DevOps Server isn't supported",
        { status: 400, platform: PLATFORM },
      );
    }
  }

  /** Without the suppress header a bad token gets a sign-in redirect, not a 401. */
  protected override createForge(options: ForgeOptions): Forge {
    return azureDevOps({
      ...options,
      organization: this.#organization ?? "",
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("X-TFS-FedAuthRedirect", "Suppress");
        return options.fetch(input, { ...init, headers });
      },
    }) as Forge;
  }

  protected override assertOwnerPath(owner: string): void {
    this.#owner(owner);
  }

  /** `organization/project`, with the organization from `baseURL` for a bare project. */
  #owner(owner: string): string {
    const slash = owner.indexOf("/");
    const organization = slash === -1 ? this.#organization : owner.slice(0, slash);
    if (organization === undefined) {
      throw new ForgesError(
        "Owner must be organization/project. A bare project works once the organization is known: baseURL, FORGES_AZURE_DEVOPS_BASE_URL or `az devops configure --defaults organization=...`",
        { status: 400, platform: PLATFORM },
      );
    }
    const project = owner.slice(slash + 1);
    encodePathSegment(organization, "Organization");
    encodePathSegment(project, "Project");
    return `${organization}/${project}`;
  }

  /** The owner goes out whole, organization included. */
  protected override repoRef(forge: Forge, { owner, repo }: RepoRef): ForgeRepoRef {
    const scoped = this.#owner(owner);
    encodePathSegment(repo, "Repository name");
    return { forge: forge.forge, instance: forge.instance, owner: scoped, name: repo };
  }

  #repoPath({ owner, repo }: RepoRef): string {
    const route = this.#owner(owner).split("/").map(encodeURIComponent).join("/");
    return `/${route}/_apis/git/repositories/${encodePathSegment(repo, "Repository name")}`;
  }

  protected override listRepos(
    owner: string,
    options?: Positioned<ListOptions>,
  ): Promise<ContinuedPage<Repository>> {
    return super.listRepos(this.#owner(owner), options);
  }

  /** `forges` reads one page of the log, so paging on `$skip` lives here. */
  protected override async listCommits(
    ref: RepoRef,
    options?: Positioned<ListCommitOptions>,
  ): Promise<NumberedPage<CommitSummary>> {
    try {
      const page = options?.page ?? 1;
      const perPage = options?.perPage ?? 30;
      const version = options?.ref === undefined ? {} : itemVersion(options.ref);
      const { value } = await this.client<{ value: AzureCommit[] }>(
        `${this.#repoPath(ref)}/commits`,
        {
          query: {
            "searchCriteria.$top": perPage + 1,
            "searchCriteria.$skip": (page - 1) * perPage,
            "searchCriteria.itemPath": options?.path === undefined ? undefined : `/${options.path}`,
            "searchCriteria.itemVersion.version": version.version,
            "searchCriteria.itemVersion.versionType": version.versionType,
            "searchCriteria.fromDate": this.#date(options?.since, "since"),
            "searchCriteria.toDate": this.#date(options?.until, "until"),
          },
        },
      );
      const hasNextPage = value.length > perPage;
      return {
        items: value.slice(0, perPage).map(commitOf),
        hasNextPage,
        ...(hasNextPage ? { nextPage: page + 1 } : {}),
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  #date(value: string | undefined, field: string): string | undefined {
    if (value === undefined) return undefined;
    const time = Date.parse(value);
    if (Number.isNaN(time)) {
      throw new ForgesError(`${field} must be an ISO 8601 date`, {
        status: 400,
        platform: PLATFORM,
      });
    }
    return new Date(time).toISOString();
  }

  /** Files from `forges`, commits from the log, which runs newest first. */
  protected override async compareCommits(
    ref: RepoRef,
    { base, head, ...options }: WithPage<CompareCommitsOptions> & { base: string; head: string },
  ): Promise<Numbered<CommitComparison>> {
    try {
      const [from, to] = [itemVersion(base), itemVersion(head)];
      const [comparison, log] = await Promise.all([
        this.forgeCall((forge) => forge.contents.compare(this.repoRef(forge, ref), base, head)),
        this.client<{ value: AzureCommit[] }>(`${this.#repoPath(ref)}/commits`, {
          query: {
            "searchCriteria.$top": MAX_RANGE,
            "searchCriteria.itemVersion.version": from.version,
            "searchCriteria.itemVersion.versionType": from.versionType,
            "searchCriteria.compareVersion.version": to.version,
            "searchCriteria.compareVersion.versionType": to.versionType,
          },
        }),
      ]);
      const commits = log.value.map(commitOf).toReversed();
      const page = options.page ?? 1;
      const raw = comparison.raw as { allChangesIncluded?: boolean };
      return {
        ...slicePage(commits, { page, perPage: options.perPage }),
        totalCount: comparison.aheadBy ?? commits.length,
        status: null,
        aheadBy: comparison.aheadBy ?? commits.length,
        behindBy: comparison.behindBy ?? null,
        mergeBaseSha: comparison.mergeBaseSha ?? null,
        files: page === 1 ? comparison.files.map(changedFileFromModel) : null,
        filesComplete: page === 1 && raw.allChangesIncluded === true ? true : null,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /** The blob's size is read before its bytes. */
  protected override async readRepositoryContents(
    ref: RepoRef,
    { path, ...options }: RepositoryContentsOptions & { path: string },
  ): Promise<RepositoryContents> {
    try {
      const revision = options.ref ?? (await this.getRepo(ref)).defaultBranch;
      const sha = isCommitSha(revision)
        ? revision
        : await this.forgeCall((forge) =>
            forge.contents.resolveRef(this.repoRef(forge, ref), revision),
          );
      assertContinuationRef(options, sha);
      const { value } = await this.client<{ value: AzureItem[] }>(`${this.#repoPath(ref)}/items`, {
        query: {
          scopePath: `/${path}`,
          recursionLevel: "oneLevel",
          "versionDescriptor.version": sha,
          "versionDescriptor.versionType": "commit",
        },
      });
      const [self, ...children] = value;
      if (self === undefined) {
        throw new NotFoundError(`No file or directory at ${path}`, { platform: PLATFORM });
      }
      if (self.isFolder === true || self.gitObjectType === "tree") {
        return {
          type: "directory",
          path,
          sha,
          entries: children.map(entryOf),
          entriesComplete: true,
        };
      }
      if (self.gitObjectType === "commit") {
        throw new ForgesError(`Repository path ${path} is a submodule, not a file or directory`, {
          status: 422,
        });
      }
      const blob = `${this.#repoPath(ref)}/blobs/${encodePathSegment(self.objectId ?? "", "Blob")}`;
      const { size } = await this.client<{ size?: number }>(blob);
      assertFileSize(path, size ?? 0);
      const bytes = await this.client<ArrayBuffer, "arrayBuffer">(blob, {
        query: { $format: "octetstream" },
        responseType: "arrayBuffer",
      });
      return buildRepositoryFileFromBytes({ path, sha, bytes: new Uint8Array(bytes) }, options);
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  #pullPath(pull: IssueRef): string {
    return `${this.#repoPath(pull)}/pullRequests/${encodePathSegment(pull.number, "Number")}`;
  }

  /** The pull request page thread comments link into. */
  #pullWeb(pull: IssueRef): string {
    const route = this.#owner(pull.owner).split("/").map(encodeURIComponent).join("/");
    const repo = encodePathSegment(pull.repo, "Repository name");
    return `${SERVICE}/${route}/_git/${repo}/pullrequest/${encodePathSegment(pull.number, "Number")}`;
  }

  /** `forges` builds threads from votes, which carry no comments. */
  async #threads(pull: IssueRef): Promise<Thread[]> {
    const { value } = await this.client<{ value: AzureThread[] }>(
      `${this.#pullPath(pull)}/threads`,
    );
    const web = this.#pullWeb(pull);
    return value.flatMap((raw) => reviewThread(raw, web) ?? []);
  }

  async #thread(pull: IssueRef, threadId: string): Promise<Thread> {
    const thread = (await this.#threads(pull)).find((candidate) => candidate.id === threadId);
    if (thread === undefined) {
      throw new NotFoundError(`Thread not found: ${threadId}`, { platform: PLATFORM });
    }
    return thread;
  }

  protected override async listThreads(
    pull: IssueRef,
    options?: WithPage<ListThreadOptions>,
  ): Promise<NumberedPage<Thread>> {
    try {
      return slicePage(
        this.filterThreadsByState(await this.#threads(pull), options?.state),
        options,
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getThread(
    pull: IssueRef,
    { threadId }: { threadId: string },
  ): Promise<Thread> {
    try {
      return await this.#thread(pull, threadId);
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /** The reply answers the thread's first comment. */
  protected override async replyToThread(
    pull: IssueRef,
    { threadId, body }: ReplyThreadInput & { threadId: string },
  ): Promise<ThreadComment> {
    try {
      const thread = await this.#thread(pull, threadId);
      const reply = await this.client<AzureComment>(
        `${this.#pullPath(pull)}/threads/${encodePathSegment(threadId, "Thread id")}/comments`,
        {
          method: "POST",
          body: {
            content: body,
            parentCommentId: Number(thread.comments[0]?.id ?? 0),
            commentType: 1,
          },
        },
      );
      return threadComment(reply, `${this.#pullWeb(pull)}?discussionId=${threadId}`);
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override resolveThread(
    pull: IssueRef,
    { threadId }: { threadId: string },
  ): Promise<Thread> {
    return this.#setResolved(pull, { threadId, resolved: true });
  }

  protected override unresolveThread(
    pull: IssueRef,
    { threadId }: { threadId: string },
  ): Promise<Thread> {
    return this.#setResolved(pull, { threadId, resolved: false });
  }

  /** `fixed` is what the web UI's Resolve button sets. */
  async #setResolved(
    pull: IssueRef,
    change: Readonly<{ threadId: string; resolved: boolean }>,
  ): Promise<Thread> {
    try {
      const thread = await this.#thread(pull, change.threadId);
      if (thread.isResolved === change.resolved) return thread;
      await this.client(
        `${this.#pullPath(pull)}/threads/${encodePathSegment(change.threadId, "Thread id")}`,
        { method: "PATCH", body: { status: change.resolved ? "fixed" : "active" } },
      );
      return { ...thread, isResolved: change.resolved };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override listReleases(
    _repo: RepoRef,
    _options?: Positioned<ListReleasesOptions>,
  ): Promise<never> {
    return missing("releases");
  }

  protected override getRelease(_repo: RepoRef, _release: { tag: string }): Promise<Release> {
    return missing("releases");
  }

  protected override createRelease(): Promise<Release> {
    return missing("releases");
  }

  protected override updateRelease(): Promise<Release> {
    return missing("releases");
  }

  /** Pipelines don't map to runs in `forges` yet; their statuses show up as checks. */
  protected override listCiRuns(
    _repo: RepoRef,
    _options?: Positioned<ListCiRunsOptions>,
  ): Promise<NumberedPage<CiRun>> {
    return missing("CI-run listing here: read a commit's or pull request's checks instead");
  }

  protected override listCiJobs(
    _repo: RepoRef,
    _options: Positioned<ListCiJobsOptions> & { runId: string },
  ): Promise<ContinuedPage<CiJob>> {
    return missing("CI-job listing here: read a commit's or pull request's checks instead");
  }
}

/**
 * Gitea/Forgejo provider implementation
 * API v1 - similar to GitHub but with key differences:
 * - Base path: /api/v1
 * - Pagination uses `limit` param instead of `per_page`
 * - Some fields may be null where GitHub returns empty strings
 */

import { Buffer } from "node:buffer";
import { createHttpClient, rawFetch, type HttpClient } from "../http.ts";
import { parseLinkHeader } from "../pagination.ts";
import { ForgesError, normalizeError, NotFoundError } from "../errors.ts";
import {
  encodeApiResponsePathSegment,
  encodePathSegment,
  encodeRefPathSegment,
  normalizeApiBaseURL,
} from "./base-url.ts";
import { Provider, type ProviderRawTypes } from "../provider.ts";
import { mapBooleanRepositoryPermission } from "../repository-access.ts";
import type {
  RepositoryContents,
  RepositoryContentsOptions,
  ProviderConfig,
  Repository,
  CiJob,
  CiJobLog,
  CiJobLogOptions,
  CiRun,
  Commit,
  CommitPatch,
  CommitPatchFile,
  CommitPatchOptions,
  CommitSummary,
  ContributionTemplateKind,
  ContributionTemplateSummary,
  Issue,
  PullRequest,
  PullRequestCheck,
  PullRequestReview,
  PullRequestFile,
  PullRequestSearchItem,
  User,
  Owner,
  PageResult,
  SearchPageResult,
  ListOptions,
  ListCiJobsOptions,
  ListCiRunsOptions,
  ListCommentOptions,
  ListCommitOptions,
  ListPullRequestChecksOptions,
  ListPullRequestReviewsOptions,
  ListPullRequestFilesOptions,
  ListThreadOptions,
  Comment,
  CreateIssueInput,
  CreatePullRequestInput,
  CreateReleaseInput,
  ListReleasesOptions,
  Release,
  ReplyThreadInput,
  Thread,
  ThreadComment,
  UpdatePullRequestInput,
  UpdateReleaseInput,
} from "../types.ts";
import { normalizeCiRunState } from "../ci-run.ts";
import { isPullRequestReview, normalizeReviewState } from "../review.ts";
import { normalizeChangedFileStatus } from "../changed-file.ts";
import { changesAssignees, nextAssignees } from "../pull-request-update.ts";
import { buildCommitPatch } from "../commit-patch.ts";
import {
  buildCiJobLog,
  jobStarted,
  mapActionsJob,
  readJobLogText,
  type ActionsJob,
} from "../ci-job-log.ts";
import {
  assertContinuationRef,
  assertFileSize,
  buildRepositoryFile,
  contentsEntryType,
  encodeRepositoryPath,
  isCommitSha,
  unreadableEntry,
} from "../repository-contents.ts";

// -- Raw Gitea API response types --

interface GiteaContent {
  type: string;
  name: string;
  path: string;
  size?: number;
  content?: string;
  encoding?: string;
}

interface GiteaIssueTemplate {
  name: string;
  file_name: string;
}

interface GiteaCiRun {
  id: number;
  head_branch?: string | null;
  head_sha?: string | null;
  ref?: string | null;
  commit_sha?: string | null;
  prettyref?: string | null;
  event_payload?: string | null;
  status: string;
  conclusion?: string | null;
  html_url?: string | null;
  url?: string | null;
}

interface GiteaCiJobsResponse {
  total_count?: number;
  jobs?: ActionsJob[];
}

interface GiteaCiRunsResponse {
  total_count: number;
  workflow_runs: GiteaCiRun[];
}

interface GiteaCommitStatus {
  id: number;
  context?: string | null;
  status: string;
  target_url?: string | null;
  url?: string | null;
}

interface GiteaCombinedStatus {
  statuses: GiteaCommitStatus[];
}

interface GiteaUser {
  id: number;
  login: string;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  is_admin?: boolean;
  description?: string | null;
  location?: string | null;
  website?: string | null;
  followers_count?: number;
  following_count?: number;
  created?: string;
  html_url?: string | null;
}

interface GiteaOwner {
  login: string;
  avatar_url?: string | null;
}

interface GiteaRepositoryParent {
  full_name: string;
  html_url?: string | null;
}

interface GiteaRepository {
  id: number;
  name: string;
  full_name: string;
  description?: string | null;
  private: boolean;
  default_branch?: string | null;
  html_url?: string | null;
  clone_url?: string | null;
  fork: boolean;
  parent?: GiteaRepositoryParent | null;
  permissions?: {
    admin?: boolean;
    push?: boolean;
    pull?: boolean;
  } | null;
  owner: GiteaOwner;
}

interface GiteaLabel {
  id: number;
  name: string;
}

interface GiteaIssue {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  state: string;
  labels?: GiteaLabel[] | null;
  user: GiteaUser;
  assignees?: GiteaUser[] | null;
  created_at: string;
  updated_at: string;
  html_url?: string | null;
  pull_request?: {
    merged?: boolean;
    draft?: boolean;
  } | null;
}

interface GiteaPullRequest {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  state: string;
  labels?: GiteaLabel[] | null;
  user: GiteaUser;
  assignees?: GiteaUser[] | null;
  created_at: string;
  updated_at: string;
  html_url?: string | null;
  head?: { ref?: string | null; label?: string | null; sha?: string | null } | null;
  base?: { ref?: string | null; label?: string | null } | null;
  merged?: boolean;
  merged_at?: string | null;
  merged_by?: GiteaUser | null;
  draft?: boolean;
  merge_commit_sha?: string | null;
  mergeable?: boolean;
}

interface GiteaPullRequestFile {
  filename: string;
  status: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

interface GiteaCommitIdentity {
  name: string;
  email: string;
  date: string;
}

interface GiteaCommit {
  sha: string;
  html_url?: string | null;
  commit: {
    message: string;
    author: GiteaCommitIdentity;
    committer: GiteaCommitIdentity;
  };
  parents?: Array<{ sha: string }>;
  files?: GiteaPullRequestFile[];
}

interface GiteaComment {
  id: number;
  body?: string | null;
  user?: GiteaUser | null;
  html_url?: string | null;
  issue_url?: string | null;
  pull_request_url?: string | null;
  created_at: string;
  updated_at: string;
}

interface GiteaRelease {
  id: number;
  tag_name: string;
  name?: string | null;
  body?: string | null;
  draft: boolean;
  prerelease: boolean;
  author?: GiteaUser | null;
  created_at: string;
  published_at?: string | null;
  html_url?: string | null;
}

interface GiteaRawTypes extends ProviderRawTypes {
  owner: GiteaOwner;
  repository: GiteaRepository;
  issue: GiteaIssue;
  pullRequest: GiteaPullRequest;
  user: GiteaUser;
  thread: GiteaReviewThread;
  comment: GiteaComment;
}

interface GiteaPullReview {
  id: number;
  user?: GiteaUser | null;
  body?: string | null;
  state?: string | null;
  commit_id?: string | null;
  dismissed?: boolean;
  submitted_at?: string | null;
  html_url?: string | null;
  comments_count?: number;
}

interface GiteaPullReviewComment {
  id: number;
  body: string;
  user?: GiteaUser | null;
  html_url?: string | null;
  created_at: string;
  path?: string | null;
  position?: number | null;
  original_position?: number | null;
  resolver?: GiteaUser | null;
}

interface GiteaReviewThread {
  comments: GiteaPullReviewComment[];
}

function branchName(ref: string | null | undefined): string {
  return ref?.replace(/^refs\/heads\//u, "") ?? "";
}

/** Older Forgejo responses keep the branch only inside the webhook payload. */
function eventPayloadBranch(eventPayload: string | null | undefined): string {
  if (!eventPayload) return "";
  try {
    const payload: unknown = JSON.parse(eventPayload);
    if (typeof payload !== "object" || payload === null) return "";
    const record = payload as Record<string, unknown>;
    const pullRequest = record.pull_request;
    if (typeof pullRequest === "object" && pullRequest !== null) {
      const head = (pullRequest as Record<string, unknown>).head;
      if (typeof head === "object" && head !== null) {
        const ref = (head as Record<string, unknown>).ref;
        if (typeof ref === "string") return branchName(ref);
      }
    }
    return typeof record.ref === "string" ? branchName(record.ref) : "";
  } catch {
    return "";
  }
}

// -- Pagination helper --

function buildPageResult<TRaw, T>(
  data: TRaw[],
  headers: Headers,
  mapper: (raw: TRaw) => T,
): PageResult<T> {
  const items = data.map(mapper);
  const links = parseLinkHeader(headers.get("Link"));
  const hasNextPage = !!links.next;

  let nextPage: number | undefined;
  if (links.next) {
    try {
      const url = new URL(links.next);
      const page = url.searchParams.get("page");
      if (page) nextPage = parseInt(page, 10);
    } catch {
      // malformed URL, ignore
    }
  }

  return { items, hasNextPage, nextPage };
}

/**
 * Build query params for Gitea list endpoints.
 * Uses `limit` instead of `per_page` (key Gitea difference).
 */
function buildListQuery(options?: ListOptions): Record<string, string> {
  const query: Record<string, string> = {};
  if (options?.page) query.page = String(options.page);
  if (options?.perPage) query.limit = String(options.perPage);
  if (options?.state) query.state = options.state;
  return query;
}

// -- Provider --

const PLATFORM = "gitea";
const GITEA_LABEL_PAGE_SIZE = 50;
const MAX_GITEA_LABEL_PAGES = 100;
const MAX_GITEA_DIFF_CHARS = 2_000_000;
const GIT_ESCAPED_BYTES: Readonly<Record<string, number>> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
};

function decodeQuotedGitPath(value: string): string | null {
  if (!value.startsWith('"') || !value.endsWith('"')) return null;
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index]!;
    if (character !== "\\") {
      bytes.push(...encoder.encode(character));
      continue;
    }
    const escape = value[++index];
    if (escape === undefined) return null;
    const escaped = GIT_ESCAPED_BYTES[escape];
    if (escaped !== undefined) {
      bytes.push(escaped);
      continue;
    }
    if (escape === '"' || escape === "\\") {
      bytes.push(escape.charCodeAt(0));
      continue;
    }
    if (/^[0-7]$/u.test(escape)) {
      let octal = escape;
      while (octal.length < 3 && /^[0-7]$/u.test(value[index + 1] ?? "")) {
        octal += value[++index];
      }
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    return null;
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

function diffSectionPath(section: string, candidatePaths: readonly string[]): string | null {
  const headerEnd = section.indexOf("\n");
  const header = section.slice(0, headerEnd === -1 ? section.length : headerEnd);
  const body = header.slice("diff --git ".length);
  if (body.endsWith('"')) {
    const quoteOffsets: number[] = [];
    let escaped = false;
    for (let index = 0; index < body.length; index += 1) {
      const character = body[index]!;
      if (character === '"' && !escaped) quoteOffsets.push(index);
      escaped = character === "\\" && !escaped;
      if (character !== "\\") escaped = false;
    }
    const openingQuote = quoteOffsets.at(-2);
    if (openingQuote === undefined) return null;
    const target = decodeQuotedGitPath(body.slice(openingQuote));
    if (target === null || !target.startsWith("b/")) return null;
    const path = target.slice(2);
    return candidatePaths.includes(path) ? path : null;
  }

  let match: string | null = null;
  for (const path of candidatePaths) {
    if (body.endsWith(` b/${path}`) && (match === null || path.length > match.length)) {
      match = path;
    }
  }
  return match;
}

function splitGitDiff(diff: string, candidatePaths: readonly string[]): Map<string, string> {
  const starts = [...diff.matchAll(/^diff --git /gmu)].map((match) => match.index);
  const sections = new Map<string, string>();
  for (const [index, start] of starts.entries()) {
    const section = diff.slice(start, starts[index + 1] ?? diff.length);
    const path = diffSectionPath(section, candidatePaths);
    if (path !== null && !sections.has(path)) sections.set(path, section);
  }
  return sections;
}

async function readBoundedGiteaDiff(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let length = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      length += chunk.length;
      if (length > MAX_GITEA_DIFF_CHARS) {
        throw new ForgesError(
          `Gitea commit diff exceeds the ${MAX_GITEA_DIFF_CHARS} character input limit`,
          413,
        );
      }
      chunks.push(chunk);
    }
    const finalChunk = decoder.decode();
    length += finalChunk.length;
    if (length > MAX_GITEA_DIFF_CHARS) {
      throw new ForgesError(
        `Gitea commit diff exceeds the ${MAX_GITEA_DIFF_CHARS} character input limit`,
        413,
      );
    }
    chunks.push(finalChunk);
    complete = true;
    return chunks.join("");
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
const GITEA_PULL_REQUEST_TEMPLATE_CANDIDATES = [
  "PULL_REQUEST_TEMPLATE.md",
  "PULL_REQUEST_TEMPLATE.yaml",
  "PULL_REQUEST_TEMPLATE.yml",
  "pull_request_template.md",
  "pull_request_template.yaml",
  "pull_request_template.yml",
  ".gitea/PULL_REQUEST_TEMPLATE.md",
  ".gitea/PULL_REQUEST_TEMPLATE.yaml",
  ".gitea/PULL_REQUEST_TEMPLATE.yml",
  ".gitea/pull_request_template.md",
  ".gitea/pull_request_template.yaml",
  ".gitea/pull_request_template.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/PULL_REQUEST_TEMPLATE.yaml",
  ".github/PULL_REQUEST_TEMPLATE.yml",
  ".github/pull_request_template.md",
  ".github/pull_request_template.yaml",
  ".github/pull_request_template.yml",
] as const;

/** Gitea ignores `limit` when `path` is set. Forgejo paginates that filter. */
function versionPagesCommitPathFilter(version: string | undefined): boolean {
  if (!version) return false;
  const normalized = version.toLowerCase();
  return normalized.includes("forgejo") || normalized.includes("+gitea-");
}

/**
 * Gitea/Forgejo provider implementation.
 */
export class GiteaProvider extends Provider<GiteaRawTypes> {
  private client: HttpClient;
  private readonly apiBaseURL: string;
  private pagedCommitPathFilter: boolean | undefined;

  /**
   * Create a Gitea/Forgejo provider.
   *
   * @param config Provider configuration. `baseURL` defaults to `https://gitea.com/api/v1`.
   */
  constructor(config: ProviderConfig) {
    super();
    const baseURL = normalizeApiBaseURL(config.baseURL, "https://gitea.com/api/v1", "/api/v1");
    this.apiBaseURL = baseURL;

    this.client = createHttpClient({
      baseURL,
      token: config.token ?? "",
      tokenHeader: "Authorization",
      tokenPrefix: "token ",
    });
  }

  protected override mapOwner(raw: GiteaOwner): Owner {
    return {
      login: raw.login,
      avatarUrl: raw.avatar_url ?? "",
    };
  }

  protected override mapRepository(raw: GiteaRepository): Repository {
    return {
      id: String(raw.id),
      name: raw.name,
      fullName: raw.full_name,
      description: raw.description ?? "",
      private: raw.private,
      defaultBranch: raw.default_branch ?? "main",
      url: raw.html_url ?? "",
      cloneUrl: raw.clone_url ?? "",
      isFork: raw.fork,
      parent: raw.parent
        ? { fullName: raw.parent.full_name, url: raw.parent.html_url ?? "" }
        : null,
      viewerPermission: mapBooleanRepositoryPermission(raw.permissions),
      owner: this.mapOwner(raw.owner),
    };
  }

  private mapCiRun(raw: GiteaCiRun): CiRun {
    const prettyBranch = raw.prettyref?.startsWith("#") ? "" : branchName(raw.prettyref);
    return {
      id: String(raw.id),
      branch:
        branchName(raw.head_branch) ||
        branchName(raw.ref) ||
        prettyBranch ||
        eventPayloadBranch(raw.event_payload),
      revision: raw.head_sha ?? raw.commit_sha ?? "",
      ...normalizeCiRunState(raw.status, raw.conclusion),
      url: raw.html_url ?? raw.url ?? "",
    };
  }

  private mapCommitSummary(raw: GiteaCommit): CommitSummary {
    return {
      sha: raw.sha,
      message: raw.commit.message,
      author: raw.commit.author,
      committer: raw.commit.committer,
      parents: (raw.parents ?? []).map((parent) => parent.sha),
      url: raw.html_url ?? "",
    };
  }

  private mapPullRequestCheck(raw: GiteaCommitStatus): PullRequestCheck {
    let url = raw.target_url ?? raw.url ?? "";
    if (url.startsWith("/")) {
      try {
        url = new URL(url, this.apiBaseURL).toString();
      } catch {
        // Preserve an unusual provider value rather than dropping the check.
      }
    }
    return {
      id: String(raw.id),
      name: raw.context || "status",
      ...normalizeCiRunState(raw.status),
      url,
    };
  }

  private mapPullRequestReview(raw: GiteaPullReview): PullRequestReview | null {
    const state = normalizeReviewState(raw.state ?? "", raw.dismissed === true);
    if (state === null) return null;
    return {
      id: String(raw.id),
      state,
      body: raw.body ?? "",
      author: { login: raw.user?.login ?? "" },
      revision: raw.commit_id ?? "",
      submittedAt: raw.submitted_at ?? "",
      url: raw.html_url ?? "",
    };
  }

  private mapRelease(raw: GiteaRelease): Release {
    return {
      id: String(raw.id),
      tag: raw.tag_name,
      name: raw.name ?? "",
      body: raw.body ?? "",
      draft: raw.draft,
      prerelease: raw.prerelease,
      author: { login: raw.author?.login ?? "" },
      createdAt: raw.created_at,
      publishedAt: raw.published_at ?? "",
      url: raw.html_url ?? "",
    };
  }

  private mapPullRequestFile(raw: GiteaPullRequestFile): PullRequestFile {
    return {
      path: raw.filename,
      status: normalizeChangedFileStatus(raw.status),
      additions: raw.additions ?? null,
      deletions: raw.deletions ?? null,
    };
  }

  protected override mapIssue(raw: GiteaIssue): Issue {
    return {
      id: String(raw.id),
      number: raw.number,
      title: raw.title,
      body: raw.body ?? "",
      state: raw.state === "open" ? "open" : "closed",
      labels: raw.labels?.map((label) => label.name) ?? [],
      author: { login: raw.user.login },
      assignees: raw.assignees?.map(({ login }) => ({ login })) ?? [],
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      url: raw.html_url ?? "",
    };
  }

  private mapPullRequestSearchItem(raw: GiteaIssue): PullRequestSearchItem {
    return {
      ...this.mapIssue(raw),
      merged: raw.pull_request?.merged ?? false,
      draft: raw.pull_request?.draft ?? false,
    };
  }

  protected override mapPullRequest(raw: GiteaPullRequest): PullRequest {
    const merged = raw.merged ?? false;
    return {
      ...this.mapPullRequestSearchItem({
        ...raw,
        pull_request: { merged, draft: raw.draft },
      }),
      sourceBranch: raw.head?.ref ?? "",
      targetBranch: raw.base?.ref ?? "",
      merged,
      draft: raw.draft ?? false,
      mergeCommitSha: merged ? (raw.merge_commit_sha ?? "") : "",
      mergedAt: merged ? (raw.merged_at ?? null) : null,
      mergedBy: merged && raw.merged_by ? { login: raw.merged_by.login } : null,
      headSha: raw.head?.sha ?? "",
      mergeable: raw.mergeable ?? null,
      mergeStatus: "",
    };
  }

  /**
   * Gitea has no company field on its user, so `company` is always empty.
   */
  protected override mapUser(raw: GiteaUser): User {
    return {
      id: String(raw.id),
      login: raw.login,
      name: raw.full_name ?? "",
      email: raw.email ?? "",
      avatarUrl: raw.avatar_url ?? "",
      isAdmin: raw.is_admin ?? false,
      bio: raw.description ?? "",
      company: "",
      location: raw.location ?? "",
      website: raw.website ?? "",
      followers: raw.followers_count ?? 0,
      following: raw.following_count ?? 0,
      createdAt: raw.created ?? "",
      url: raw.html_url ?? "",
    };
  }

  protected override mapComment(raw: GiteaComment): Comment {
    return {
      id: String(raw.id),
      body: raw.body ?? "",
      author: { login: raw.user?.login ?? "" },
      url: raw.html_url ?? "",
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  }

  protected override mapThread(raw: GiteaReviewThread): Thread {
    const first = raw.comments[0];
    // Gitea fills exactly one side: `position` is the new-file line,
    // `original_position` the old-file line, and the unused one serializes as 0.
    // Its internal `Invalidated` flag is not part of the API, so an outdated
    // comment is indistinguishable from a current one here.
    const position = first?.position ?? 0;
    const originalPosition = first?.original_position ?? 0;
    const line = position > 0 ? position : originalPosition;
    return {
      id: first === undefined ? "" : String(first.id),
      isResolved: raw.comments.some((comment) => comment.resolver != null),
      isOutdated: false,
      path: first?.path ?? "",
      line: line > 0 ? line : null,
      startLine: null,
      comments: raw.comments.map((comment) => ({
        id: String(comment.id),
        body: comment.body,
        author: { login: comment.user?.login ?? "" },
        url: comment.html_url ?? "",
        createdAt: comment.created_at,
      })),
    };
  }

  protected override async listRepos(
    owner: string,
    options?: ListOptions,
  ): Promise<PageResult<Repository>> {
    try {
      const query = buildListQuery(options);
      const { data, headers } = await rawFetch<GiteaRepository[]>(
        this.client,
        `/users/${encodePathSegment(owner)}/repos`,
        { query },
      );
      return buildPageResult(data ?? [], headers, (raw) => this.mapRepository(raw));
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getRepo(owner: string, repo: string): Promise<Repository> {
    try {
      return this.mapRepository(
        await this.client<GiteaRepository>(
          `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`,
        ),
      );
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
      const route = `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`;
      const sha = isCommitSha(options?.ref)
        ? options.ref
        : (
            await this.client<GiteaCommit>(
              `${route}/git/commits/${encodeRefPathSegment(options?.ref ?? "HEAD")}`,
              { query: { stat: "false", files: "false", verification: "false" } },
            )
          ).sha;
      assertContinuationRef(options, sha);
      const contents = await this.client<GiteaContent[] | GiteaContent>(
        `${route}/contents${path === "" ? "" : `/${encodeRepositoryPath(path)}`}`,
        { query: { ref: sha } },
      );
      if (Array.isArray(contents)) {
        return {
          type: "directory",
          path,
          sha,
          entries: contents.map((entry) => ({
            name: entry.name,
            path: entry.path,
            type: contentsEntryType(entry.type),
            size: entry.type === "file" ? (entry.size ?? null) : null,
          })),
          entriesComplete: true,
        };
      }
      if (contents.type !== "file") throw unreadableEntry(path, contents.type);
      assertFileSize(path, contents.size ?? 0);
      if (contents.encoding !== "base64" || contents.content === undefined) {
        throw new ForgesError(`Gitea returned no content for ${path}`, 502, PLATFORM);
      }
      return buildRepositoryFile(path, sha, contents.content, options);
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  private contributionTemplateContentsRoute(owner: string, repo: string, path: string): string {
    const encodedPath = path.split("/").map(encodeApiResponsePathSegment).join("/");
    return `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/contents/${encodedPath}`;
  }

  private async tryContributionTemplateFile(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<GiteaContent | null> {
    try {
      const file = await this.client<GiteaContent>(
        this.contributionTemplateContentsRoute(owner, repo, path),
        { query: { ref } },
      );
      return file.type === "file" ? file : null;
    } catch (error) {
      const normalized = normalizeError(error, PLATFORM);
      if (normalized.status === 404) return null;
      throw normalized;
    }
  }

  private giteaTemplateSummary(
    repository: GiteaRepository,
    kind: ContributionTemplateKind,
    key: string,
    name: string,
  ): ContributionTemplateSummary {
    return {
      kind,
      key,
      name,
      scope: "repository",
      inherited: false,
      sourceRepository: repository.full_name,
      sourcePath: key,
      sourceRef: repository.default_branch ?? "main",
    };
  }

  protected override async listContributionTemplates(
    owner: string,
    repo: string,
    kind: ContributionTemplateKind,
  ): Promise<ContributionTemplateSummary[]> {
    try {
      const repository = await this.client<GiteaRepository>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`,
      );
      if (kind === "issue") {
        const rows = await this.client<GiteaIssueTemplate[]>(
          `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issue_templates`,
        );
        const seen = new Set<string>();
        return rows.flatMap((row): ContributionTemplateSummary[] => {
          if (seen.has(row.file_name)) return [];
          seen.add(row.file_name);
          const fallbackName =
            row.file_name
              .split("/")
              .at(-1)
              ?.replace(/\.[^.]+$/u, "") ?? "";
          return [
            this.giteaTemplateSummary(repository, kind, row.file_name, row.name || fallbackName),
          ];
        });
      }

      const sourceRef = repository.default_branch ?? "main";
      for (const candidate of GITEA_PULL_REQUEST_TEMPLATE_CANDIDATES) {
        const file = await this.tryContributionTemplateFile(owner, repo, candidate, sourceRef);
        if (file === null) continue;
        const name = file.name.replace(/\.[^.]+$/u, "");
        return [this.giteaTemplateSummary(repository, kind, file.path, name)];
      }
      return [];
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async readContributionTemplate(
    owner: string,
    repo: string,
    template: ContributionTemplateSummary,
  ): Promise<string> {
    try {
      if (template.sourcePath === null || template.sourceRef === null) {
        throw new ForgesError("Gitea template source metadata is incomplete", 502, PLATFORM);
      }
      const file = await this.client<GiteaContent>(
        this.contributionTemplateContentsRoute(owner, repo, template.sourcePath),
        { query: { ref: template.sourceRef } },
      );
      if (file.type !== "file" || file.encoding !== "base64" || file.content === undefined) {
        throw new ForgesError("Gitea did not return decodable template content", 502, PLATFORM);
      }
      return Buffer.from(file.content.replaceAll("\n", ""), "base64").toString("utf8");
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async listCiRuns(
    owner: string,
    repo: string,
    options?: ListCiRunsOptions,
  ): Promise<PageResult<CiRun>> {
    try {
      const page = options?.page ?? 1;
      const perPage = options?.perPage ?? 30;
      const query: Record<string, string> = {
        page: String(page),
        limit: String(perPage),
      };
      if (options?.branch) query.branch = options.branch;

      const { data, headers } = await rawFetch<GiteaCiRunsResponse>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/actions/runs`,
        { query },
      );
      const totalCount = data?.total_count;
      const result = buildPageResult(data?.workflow_runs ?? [], headers, (raw) =>
        this.mapCiRun(raw),
      );
      const hasNextPage =
        result.hasNextPage || (totalCount !== undefined && page * perPage < totalCount);
      return {
        ...result,
        totalCount,
        hasNextPage,
        nextPage: hasNextPage ? (result.nextPage ?? page + 1) : undefined,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async listCiJobs(
    owner: string,
    repo: string,
    runId: string,
    options?: ListCiJobsOptions,
  ): Promise<PageResult<CiJob>> {
    try {
      const page = options?.page ?? 1;
      const perPage = options?.perPage ?? 30;
      const { data, headers } = await rawFetch<GiteaCiJobsResponse>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/actions/runs/${runId}/jobs`,
        { query: { page: String(page), limit: String(perPage) } },
      );
      const totalCount = data?.total_count;
      const result = buildPageResult(data?.jobs ?? [], headers, mapActionsJob);
      const hasNextPage =
        result.hasNextPage || (totalCount !== undefined && page * perPage < totalCount);
      return {
        ...result,
        totalCount,
        hasNextPage,
        nextPage: hasNextPage ? (result.nextPage ?? page + 1) : undefined,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async readCiJobLog(
    owner: string,
    repo: string,
    jobId: string,
    options?: CiJobLogOptions,
  ): Promise<CiJobLog> {
    try {
      const route = `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/actions/jobs/${jobId}`;
      const job = mapActionsJob(await this.client<ActionsJob>(route));
      if (!jobStarted(job, true)) return buildCiJobLog(job, null, options);
      const stream = await this.client<unknown, "stream">(`${route}/logs`, {
        responseType: "stream",
      });
      const log = await readJobLogText(stream);
      return buildCiJobLog(job, { ...log, timestamped: true }, options);
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  private async commitPathFilterIsPaged(): Promise<boolean> {
    if (this.pagedCommitPathFilter !== undefined) {
      return this.pagedCommitPathFilter;
    }
    try {
      const info = await this.client<{ version?: string }>("/version");
      this.pagedCommitPathFilter = versionPagesCommitPathFilter(info?.version);
      return this.pagedCommitPathFilter;
    } catch {
      return false;
    }
  }

  protected override async listCommits(
    owner: string,
    repo: string,
    options?: ListCommitOptions,
  ): Promise<PageResult<CommitSummary>> {
    try {
      if (options?.path && !(await this.commitPathFilterIsPaged())) {
        throw new ForgesError(
          "Path-filtered commit listing is not supported by Gitea because its API ignores pagination limits",
          501,
          PLATFORM,
        );
      }

      const page = options?.page ?? 1;
      const query: Record<string, string> = {
        stat: "false",
        verification: "false",
        files: "false",
        page: String(page),
        limit: String(options?.perPage ?? 30),
      };
      if (options?.ref) query.sha = options.ref;
      if (options?.path) query.path = options.path;
      if (options?.since) query.since = options.since;
      if (options?.until) query.until = options.until;

      const { data, headers } = await rawFetch<GiteaCommit[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/commits`,
        { query },
      );
      const result = buildPageResult(data ?? [], headers, (raw) => this.mapCommitSummary(raw));
      const totalHeader = headers.get("x-total-count");
      const totalCount = totalHeader === null ? undefined : Number.parseInt(totalHeader, 10);
      const hasNextPage = result.hasNextPage || headers.get("x-hasmore") === "true";
      return {
        ...result,
        totalCount: Number.isInteger(totalCount) ? totalCount : undefined,
        hasNextPage,
        nextPage: hasNextPage ? (result.nextPage ?? page + 1) : undefined,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getCommit(owner: string, repo: string, sha: string): Promise<Commit> {
    try {
      const commit = await this.client<GiteaCommit>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/git/commits/${encodePathSegment(sha)}`,
      );
      return {
        ...this.mapCommitSummary(commit),
        files: (commit.files ?? []).map((file) => this.mapPullRequestFile(file)),
        filesComplete: null,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async readCommitPatch(
    owner: string,
    repo: string,
    sha: string,
    options?: CommitPatchOptions,
  ): Promise<CommitPatch> {
    try {
      const commit = await this.client<GiteaCommit>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/git/commits/${encodeRefPathSegment(sha)}`,
      );
      if ((options?.offset ?? 0) > 0 && sha !== commit.sha) {
        throw new ForgesError(
          "Continue commit patches with the resolved SHA from the first page",
          409,
        );
      }
      const diffStream = await this.client<unknown, "stream">(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/git/commits/${encodePathSegment(commit.sha)}.diff`,
        { responseType: "stream" },
      );
      const commitFiles = commit.files ?? [];
      const sections = splitGitDiff(
        await readBoundedGiteaDiff(diffStream),
        commitFiles.map((file) => file.filename),
      );
      const files: CommitPatchFile[] = commitFiles.map((file) => {
        const patch = sections.get(file.filename);
        const binary =
          patch !== undefined && /^(?:Binary files .+ differ|GIT binary patch)$/mu.test(patch);
        return {
          path: file.filename,
          previousPath: null,
          status: normalizeChangedFileStatus(file.status),
          state: patch === undefined ? "unavailable" : binary ? "binary" : "included",
          patch: patch === undefined || binary ? "" : patch,
        };
      });
      return buildCommitPatch(commit.sha, files, null, options);
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }
  // --- Releases ---

  private releasesRoute(owner: string, repo: string): string {
    return `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/releases`;
  }

  protected override async listReleases(
    owner: string,
    repo: string,
    options?: ListReleasesOptions,
  ): Promise<PageResult<Release>> {
    try {
      const page = options?.page ?? 1;
      const perPage = options?.perPage ?? 30;
      const { data, headers } = await rawFetch<GiteaRelease[]>(
        this.client,
        this.releasesRoute(owner, repo),
        { query: { page: String(page), limit: String(perPage) } },
      );
      const total = Number.parseInt(headers.get("x-total-count") ?? "", 10);
      const result = buildPageResult(data ?? [], headers, (raw) => this.mapRelease(raw));
      const hasNextPage = result.hasNextPage || (Number.isFinite(total) && page * perPage < total);
      return {
        ...result,
        totalCount: Number.isFinite(total) ? total : undefined,
        hasNextPage,
        nextPage: hasNextPage ? (result.nextPage ?? page + 1) : undefined,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  private async readRelease(owner: string, repo: string, tag: string): Promise<GiteaRelease> {
    try {
      return await this.client<GiteaRelease>(
        `${this.releasesRoute(owner, repo)}/tags/${encodeRefPathSegment(tag)}`,
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getRelease(owner: string, repo: string, tag: string): Promise<Release> {
    return this.mapRelease(await this.readRelease(owner, repo, tag));
  }

  protected override async createRelease(
    owner: string,
    repo: string,
    input: CreateReleaseInput,
  ): Promise<Release> {
    try {
      return this.mapRelease(
        await this.client<GiteaRelease>(this.releasesRoute(owner, repo), {
          method: "POST",
          body: {
            tag_name: input.tag,
            target_commitish: input.ref,
            name: input.name,
            body: input.body,
            draft: input.draft,
            prerelease: input.prerelease,
          },
        }),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /** Gitea edits by id, so the tag is read first. */
  protected override async updateRelease(
    owner: string,
    repo: string,
    tag: string,
    input: UpdateReleaseInput,
  ): Promise<Release> {
    const release = await this.readRelease(owner, repo, tag);
    try {
      return this.mapRelease(
        await this.client<GiteaRelease>(
          `${this.releasesRoute(owner, repo)}/${encodePathSegment(release.id)}`,
          {
            method: "PATCH",
            body: {
              name: input.name,
              body: input.body,
              draft: input.draft,
              prerelease: input.prerelease,
            },
          },
        ),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async listIssues(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<Issue>> {
    try {
      const query = buildListQuery(options);
      query.type = "issues";
      const { data, headers } = await rawFetch<GiteaIssue[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues`,
        { query },
      );
      return buildPageResult(data ?? [], headers, (raw) => this.mapIssue(raw));
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async searchIssues(
    owner: string,
    repo: string,
    searchQuery: string,
    options?: ListOptions,
  ): Promise<SearchPageResult<Issue>> {
    try {
      const query = buildListQuery(options);
      query.q = searchQuery;
      query.type = "issues";
      const { data, headers } = await rawFetch<GiteaIssue[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues`,
        { query },
      );
      return {
        ...buildPageResult(data ?? [], headers, (raw) => this.mapIssue(raw)),
        incomplete: false,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getIssue(owner: string, repo: string, number: number): Promise<Issue> {
    try {
      const issue = await this.client<GiteaIssue>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues/${encodePathSegment(number)}`,
      );
      if (issue.pull_request != null) {
        throw new NotFoundError(`Issue not found: ${number}`, PLATFORM);
      }
      return this.mapIssue(issue);
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async createIssue(
    owner: string,
    repo: string,
    input: CreateIssueInput,
  ): Promise<Issue> {
    try {
      const body: Record<string, unknown> = {
        title: input.title,
        body: input.body,
      };
      if (input.assignees?.length) {
        body.assignees = input.assignees;
      }
      if (input.labels?.length) {
        body.labels = await this.resolveIssueLabelIds(owner, repo, input.labels);
      }
      return this.mapIssue(
        await this.client<GiteaIssue>(
          `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues`,
          {
            method: "POST",
            body,
          },
        ),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  private async resolveIssueLabelIds(
    owner: string,
    repo: string,
    names: readonly string[],
  ): Promise<number[]> {
    const ids = new Map<string, number>();
    const pending = new Set(names);
    await this.collectIssueLabelIds(
      `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/labels`,
      pending,
      ids,
    );

    if (pending.size > 0) {
      try {
        await this.collectIssueLabelIds(`/orgs/${encodePathSegment(owner)}/labels`, pending, ids);
      } catch (error) {
        const normalized = normalizeError(error, PLATFORM);
        if (normalized.status !== 404) throw normalized;
      }
    }

    if (pending.size > 0) {
      throw new NotFoundError(`Labels not found: ${[...pending].join(", ")}`, PLATFORM);
    }
    return names.map((name) => {
      const id = ids.get(name);
      if (id === undefined) {
        throw new NotFoundError(`Label not found: ${name}`, PLATFORM);
      }
      return id;
    });
  }

  private async collectIssueLabelIds(
    path: string,
    pending: Set<string>,
    ids: Map<string, number>,
  ): Promise<void> {
    let page = 1;
    while (pending.size > 0 && page <= MAX_GITEA_LABEL_PAGES) {
      const { data, headers } = await rawFetch<GiteaLabel[]>(this.client, path, {
        query: { page: String(page), limit: String(GITEA_LABEL_PAGE_SIZE) },
      });
      const labels = data ?? [];
      for (const label of labels) {
        if (pending.delete(label.name)) ids.set(label.name, label.id);
      }

      const totalHeader = headers.get("x-total-count");
      const total = totalHeader === null ? undefined : Number(totalHeader);
      const hasNextPage =
        parseLinkHeader(headers.get("Link")).next !== undefined ||
        headers.get("x-hasmore") === "true" ||
        (Number.isSafeInteger(total) && total !== undefined && total >= 0
          ? page * GITEA_LABEL_PAGE_SIZE < total
          : labels.length === GITEA_LABEL_PAGE_SIZE);
      if (!hasNextPage) break;
      if (page === MAX_GITEA_LABEL_PAGES) {
        throw new ForgesError("Gitea label lookup exceeded its pagination limit", 502, PLATFORM);
      }
      page += 1;
    }
  }

  protected override async listPullRequests(
    owner: string,
    repo: string,
    options?: ListOptions,
  ): Promise<PageResult<PullRequest>> {
    try {
      const query = buildListQuery(options);
      const { data, headers } = await rawFetch<GiteaPullRequest[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls`,
        { query },
      );
      return buildPageResult(data ?? [], headers, (raw) => this.mapPullRequest(raw));
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async listPullRequestFiles(
    owner: string,
    repo: string,
    number: number,
    options?: ListPullRequestFilesOptions,
  ): Promise<PageResult<PullRequestFile>> {
    try {
      const query = buildListQuery(options);
      const { data, headers } = await rawFetch<GiteaPullRequestFile[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}/files`,
        { query },
      );
      return buildPageResult(data ?? [], headers, (raw) => this.mapPullRequestFile(raw));
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async listPullRequestChecks(
    owner: string,
    repo: string,
    number: number,
    options?: ListPullRequestChecksOptions,
  ): Promise<PageResult<PullRequestCheck>> {
    try {
      const pullRequest = await this.getPullRequest(owner, repo, number);
      const page = options?.page ?? 1;
      const perPage = options?.perPage ?? 30;
      const path = `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/commits/${encodePathSegment(pullRequest.headSha)}/status`;
      const { data, headers } = await rawFetch<GiteaCombinedStatus>(this.client, path, {
        query: { page: String(page), limit: String(perPage) },
      });
      const statuses = data?.statuses ?? [];
      let hasNextPage = !!parseLinkHeader(headers.get("Link")).next;

      // Forgejo paginates combined statuses but omits Link. Probe only when a
      // full page leaves the existence of another page ambiguous.
      if (!hasNextPage && statuses.length === perPage) {
        const next = await rawFetch<GiteaCombinedStatus>(this.client, path, {
          query: { page: String(page + 1), limit: String(perPage) },
        });
        hasNextPage = (next.data?.statuses.length ?? 0) > 0;
      }

      return {
        items: statuses.map((raw) => this.mapPullRequestCheck(raw)),
        hasNextPage,
        nextPage: hasNextPage ? page + 1 : undefined,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getPullRequestReview(
    owner: string,
    repo: string,
    number: number,
    reviewId: string,
  ): Promise<PullRequestReview> {
    try {
      const raw = await this.client<GiteaPullReview>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}/reviews/${encodePathSegment(reviewId)}`,
      );
      const review = this.mapPullRequestReview(raw);
      if (review === null) {
        throw new ForgesError(
          "This review state cannot be represented as a pull request review",
          501,
          PLATFORM,
        );
      }
      return review;
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /**
   * Gitea and Forgejo count this list in `x-total-count` and send no Link for it. The count
   * includes the review requests this list drops, so it is not reported as totalCount.
   */
  protected override async listPullRequestReviews(
    owner: string,
    repo: string,
    number: number,
    options?: ListPullRequestReviewsOptions,
  ): Promise<PageResult<PullRequestReview>> {
    try {
      const page = options?.page ?? 1;
      const perPage = options?.perPage ?? 30;
      const { data, headers } = await rawFetch<GiteaPullReview[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}/reviews`,
        { query: { page: String(page), limit: String(perPage) } },
      );
      const total = Number.parseInt(headers.get("x-total-count") ?? "", 10);
      const hasNextPage =
        !!parseLinkHeader(headers.get("Link")).next ||
        (Number.isFinite(total) && page * perPage < total);
      return {
        items: (data ?? [])
          .map((raw) => this.mapPullRequestReview(raw))
          .filter(isPullRequestReview),
        hasNextPage,
        nextPage: hasNextPage ? page + 1 : undefined,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async searchPullRequests(
    owner: string,
    repo: string,
    searchQuery: string,
    options?: ListOptions,
  ): Promise<SearchPageResult<PullRequestSearchItem>> {
    try {
      const query = buildListQuery(options);
      query.q = searchQuery;
      query.type = "pulls";
      const { data, headers } = await rawFetch<GiteaIssue[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues`,
        { query },
      );
      return {
        ...buildPageResult(data ?? [], headers, (raw) => this.mapPullRequestSearchItem(raw)),
        incomplete: false,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getPullRequest(
    owner: string,
    repo: string,
    number: number,
  ): Promise<PullRequest> {
    try {
      return this.mapPullRequest(
        await this.client<GiteaPullRequest>(
          `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}`,
        ),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async createPullRequest(
    owner: string,
    repo: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequest> {
    try {
      const body: Record<string, unknown> = {
        title: input.title,
        body: input.body,
        head: input.sourceBranch,
        base: input.targetBranch,
      };
      if (input.assignees?.length) {
        body.assignees = input.assignees;
      }
      if (input.draft !== undefined) {
        body.draft = input.draft;
      }
      return this.mapPullRequest(
        await this.client<GiteaPullRequest>(
          `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls`,
          {
            method: "POST",
            body,
          },
        ),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /**
   * Labels change through the issue endpoints, which add and remove by id and
   * leave the rest alone; the edit route would need the whole list and reads an
   * empty one as no change. Assignees go out as the whole list with the rest, so
   * the pull request is read first, which also keeps an issue number from getting
   * its labels changed by mistake.
   */
  protected override async updatePullRequest(
    owner: string,
    repo: string,
    number: number,
    input: UpdatePullRequestInput,
  ): Promise<PullRequest> {
    const repository = `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`;
    const pullPath = `${repository}/pulls/${encodePathSegment(number)}`;
    const issuePath = `${repository}/issues/${encodePathSegment(number)}`;
    try {
      const labelWrites = Boolean(input.addLabels?.length || input.removeLabels?.length);
      const current =
        labelWrites || changesAssignees(input)
          ? await this.client<GiteaPullRequest>(pullPath)
          : undefined;

      if (input.addLabels?.length) {
        const ids = await this.resolveIssueLabelIds(owner, repo, input.addLabels);
        await this.client(`${issuePath}/labels`, { method: "POST", body: { labels: ids } });
      }
      const removed = new Set(input.removeLabels);
      for (const label of current?.labels ?? []) {
        if (!removed.has(label.name)) continue;
        await this.client(`${issuePath}/labels/${encodePathSegment(label.id)}`, {
          method: "DELETE",
        });
      }

      const body: Record<string, unknown> = {};
      if (input.title !== undefined) body.title = input.title;
      if (input.body !== undefined) body.body = input.body;
      if (input.state !== undefined) body.state = input.state;
      if (current && changesAssignees(input)) {
        body.assignees = nextAssignees(
          (current.assignees ?? []).map(({ login }) => login),
          input,
        );
      }

      return this.mapPullRequest(
        Object.keys(body).length > 0
          ? await this.client<GiteaPullRequest>(pullPath, { method: "PATCH", body })
          : await this.client<GiteaPullRequest>(pullPath),
      );
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  // --- Comments ---

  /**
   * The issue-comments route ignores page and limit and answers with the whole
   * discussion, so the requested page is cut locally after an id sort that
   * pins the documented oldest-first order. The paging params still go out and
   * the Link header is still read, so a host that does paginate this route
   * stays correct and is only walked one comment past the requested slice
   * instead of to the end; a pending next link then answers hasNextPage.
   */
  protected override async listIssueComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>> {
    try {
      const perPage = options?.perPage ?? 30;
      const page = options?.page ?? 1;
      const start = (page - 1) * perPage;
      const comments: GiteaComment[] = [];
      let remotePage = 1;
      let hasMore = true;
      while (hasMore && comments.length <= start + perPage) {
        const { data, headers } = await rawFetch<GiteaComment[]>(
          this.client,
          `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues/${encodePathSegment(number)}/comments`,
          { query: { page: String(remotePage), limit: "50" } },
        );
        const batch = data ?? [];
        if (batch.length === 0) {
          hasMore = false;
          break;
        }
        comments.push(...batch);
        hasMore = !!parseLinkHeader(headers.get("Link")).next;
        remotePage += 1;
      }
      comments.sort((left, right) => left.id - right.id);

      const items = comments.slice(start, start + perPage).map((raw) => this.mapComment(raw));
      const hasNextPage = hasMore || start + items.length < comments.length;
      return {
        items,
        hasNextPage,
        nextPage: hasNextPage ? page + 1 : undefined,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /** Gitea indexes pull requests as issues, so their discussion shares this route. */
  protected override async listPullRequestComments(
    owner: string,
    repo: string,
    number: number,
    options?: ListCommentOptions,
  ): Promise<PageResult<Comment>> {
    return this.listIssueComments(owner, repo, number, options);
  }

  /**
   * Gitea keys discussion comments by id alone, so the endpoint cannot scope
   * the read. The comment names its issue or pull request by URL and issues
   * share the index space with pulls, so either one matching the requested
   * number passes; anything else answers 404 like it does on GitLab. A
   * payload carrying neither URL skips the check, because rejecting it would
   * fail every read against a server that omits the association.
   */
  protected override async getIssueComment(
    owner: string,
    repo: string,
    number: number,
    commentId: string,
  ): Promise<Comment> {
    try {
      const data = await this.client<GiteaComment>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues/comments/${encodePathSegment(commentId)}`,
      );
      const association = data.issue_url || data.pull_request_url;
      if (
        association &&
        !association.endsWith(`/issues/${number}`) &&
        !association.endsWith(`/pulls/${number}`)
      ) {
        throw new NotFoundError(`Comment not found: ${commentId}`, PLATFORM);
      }
      return this.mapComment(data);
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /** Pull-request discussion comments live on the issues endpoint too. */
  protected override async getPullRequestComment(
    owner: string,
    repo: string,
    number: number,
    commentId: string,
  ): Promise<Comment> {
    return this.getIssueComment(owner, repo, number, commentId);
  }

  protected override async getUser(username: string): Promise<User> {
    try {
      return this.mapUser(await this.client<GiteaUser>(`/users/${encodePathSegment(username)}`));
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getAuthenticatedUser(): Promise<User> {
    try {
      return this.mapUser(await this.client<GiteaUser>("/user"));
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  // --- Threads ---

  protected override async listThreads(
    owner: string,
    repo: string,
    number: number,
    options?: ListThreadOptions,
  ): Promise<PageResult<Thread>> {
    try {
      const threads = this.filterThreadsByState(
        (await this.groupedReviewThreads(owner, repo, number)).map((thread) =>
          this.mapThread(thread),
        ),
        options?.state,
      );
      const perPage = options?.perPage ?? 30;
      const page = options?.page ?? 1;
      const start = (page - 1) * perPage;
      const items = threads.slice(start, start + perPage);
      const hasNextPage = start + items.length < threads.length;
      return {
        items,
        hasNextPage,
        nextPage: hasNextPage ? page + 1 : undefined,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async getThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread> {
    try {
      return this.mapThread(await this.findReviewThread(owner, repo, number, threadId));
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /**
   * Gitea has no parent id on review comments, so every comment is its own
   * thread and the thread id is that comment id. Mutations address the comment
   * directly instead of rescanning every review on the pull request.
   */
  protected override async replyToThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
    input: ReplyThreadInput,
  ): Promise<ThreadComment> {
    try {
      const comment = await this.client<GiteaPullReviewComment>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}/comments/${encodePathSegment(threadId)}/replies`,
        {
          method: "POST",
          body: { body: input.body },
        },
      );
      return {
        id: String(comment.id),
        body: comment.body,
        author: { login: comment.user?.login ?? "" },
        url: comment.html_url ?? "",
        createdAt: comment.created_at,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  protected override async resolveThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread> {
    return this.setReviewThreadResolved(owner, repo, number, threadId, true);
  }

  protected override async unresolveThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<Thread> {
    return this.setReviewThreadResolved(owner, repo, number, threadId, false);
  }

  private async setReviewThreadResolved(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
    resolved: boolean,
  ): Promise<Thread> {
    try {
      // Unlike the reply endpoint, resolve/unresolve is scoped only by repository
      // and comment id, so the comment must be confirmed to sit on this pull
      // request before it is mutated.
      const thread = await this.findReviewThread(owner, repo, number, threadId);
      const action = resolved ? "resolve" : "unresolve";
      await this.client(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/comments/${encodePathSegment(threadId)}/${action}`,
        { method: "POST" },
      );
      return { ...this.mapThread(thread), isResolved: resolved };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  private async findReviewThread(
    owner: string,
    repo: string,
    number: number,
    threadId: string,
  ): Promise<GiteaReviewThread> {
    const thread = (await this.groupedReviewThreads(owner, repo, number)).find(
      (candidate) => String(candidate.comments[0]?.id) === threadId,
    );
    if (!thread) {
      throw new NotFoundError(
        `Resource not found: thread ${threadId} on ${owner}/${repo}#${number}`,
        PLATFORM,
      );
    }
    return thread;
  }

  private async reviewComments(
    owner: string,
    repo: string,
    number: number,
    reviewId: number,
  ): Promise<GiteaPullReviewComment[]> {
    const comments: GiteaPullReviewComment[] = [];
    let page = 1;
    let hasNextPage = true;
    while (hasNextPage) {
      const { data, headers } = await rawFetch<GiteaPullReviewComment[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}/reviews/${encodePathSegment(reviewId)}/comments`,
        { query: { page: String(page), limit: "50" } },
      );
      const batch = data ?? [];
      if (batch.length === 0) {
        break;
      }
      comments.push(...batch);
      hasNextPage = !!parseLinkHeader(headers.get("Link")).next;
      page += 1;
    }
    return comments;
  }

  /** The reviews route sends no Link, so the walk ends when `x-total-count` reviews were read. */
  private async groupedReviewThreads(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GiteaReviewThread[]> {
    const comments: GiteaPullReviewComment[] = [];
    let page = 1;
    let seen = 0;
    let hasNextPage = true;
    while (hasNextPage) {
      const { data, headers } = await rawFetch<GiteaPullReview[]>(
        this.client,
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${encodePathSegment(number)}/reviews`,
        { query: { page: String(page), limit: "50" } },
      );
      const reviews = data ?? [];
      if (reviews.length === 0) {
        break;
      }
      for (const review of reviews) {
        if (review.comments_count === 0) {
          continue;
        }
        comments.push(...(await this.reviewComments(owner, repo, number, review.id)));
      }
      seen += reviews.length;
      const total = Number.parseInt(headers.get("x-total-count") ?? "", 10);
      hasNextPage =
        !!parseLinkHeader(headers.get("Link")).next || (Number.isFinite(total) && seen < total);
      page += 1;
    }

    return comments
      .slice()
      .sort((left, right) => left.id - right.id)
      .map((comment) => ({ comments: [comment] }));
  }
}

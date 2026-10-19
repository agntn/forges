/**
 * Shared base for the providers built on `forges`.
 *
 * `forges` sends the requests, picks the endpoints and walks the pages. Where
 * its model says the same as ours, the base maps that; elsewhere a provider
 * maps the forge's own payload, which `forges` keeps as `raw`.
 */

import type {
  Cursor,
  ForgeListing,
  ForgeProvider as Forge,
  Page,
  RepoRef,
  ThreadKind,
  ThreadRef,
} from "forges";

import type { PagePosition } from "../cursor.ts";
import { Buffer } from "node:buffer";
import { sha256 } from "@agntn/hashes/sha2";

import { encodePathSegment, encodeRefPathSegment } from "./base-url.ts";
import { normalizeChangedFileStatus } from "../changed-file.ts";
import { ForgesError, normalizeError } from "../errors.ts";
import { createForgeClient, toFetchError, type HttpClient } from "../http.ts";
import {
  Provider,
  type ContinuedPage,
  type Positioned,
  type ProviderRawTypes,
} from "../provider.ts";
import type {
  CiJob,
  CiRun,
  CommitSummary,
  Comment,
  CreateReleaseInput,
  Issue,
  ListCommentOptions,
  ListPullRequestFilesOptions,
  PullRequestFile,
  ListCiJobsOptions,
  ListCiRunsOptions,
  ListCommitOptions,
  ListOptions,
  ListReleasesOptions,
  ListTagsOptions,
  Release,
  Repository,
  Tag,
  UpdateReleaseInput,
  User,
} from "../types.ts";

/** Page options as `forges` reads them. */
interface ForgePageOptions {
  perPage?: number;
  cursor?: Cursor;
}

export abstract class ForgeBackedProvider<
  Raw extends ProviderRawTypes = ProviderRawTypes,
> extends Provider<Raw> {
  /** Requests the `forges` model does not cover, sent through the same provider. */
  protected readonly client: HttpClient;
  readonly #platform: string;
  readonly #apiBaseURL: string;
  readonly #anonymous: boolean;
  #forge: Promise<Forge> | undefined;
  #refreshed: Promise<unknown> | undefined;

  /** The cache scope hashes the token: a key can reach external storage, a credential must not. */
  protected constructor(platform: string, apiBaseURL: string, token: string) {
    super(platform);
    this.#platform = platform;
    this.#apiBaseURL = apiBaseURL;
    this.#anonymous = token === "";
    const credential = Buffer.from(sha256(Buffer.from(token))).toString("hex", 0, 8);
    this.client = createForgeClient(() => this.#open(), { scope: `${apiBaseURL}#${credential}` });
  }

  /** Creates the `forges` provider; called once, on the first request. */
  protected abstract openForge(): Promise<Forge>;

  /** Maps the forge's own release payload. */
  protected abstract mapRelease(raw: never): Release;

  /** Maps the forge's own commit payload, as a listing serves it. */
  protected abstract mapCommitSummary(raw: never): CommitSummary;

  /** Maps the forge's own CI run payload. */
  protected abstract mapCiRun(raw: never): CiRun;

  /** Maps the forge's own CI job payload. */
  protected abstract mapCiJob(raw: never): CiJob;

  /** A base URL that does not parse fails on the first request, where forges opens it. */
  protected override cursorOrigin(): string | undefined {
    return URL.parse(this.#apiBaseURL)?.origin;
  }

  /** One `forges` call; a refusal gated on an unknown version reads it once and retries. */
  protected async forgeCall<T>(run: (forge: Forge) => Promise<T>): Promise<T> {
    const forge = await this.#open();
    try {
      return await run(forge);
    } catch (error) {
      if (!isUnsupported(error) || this.#refreshed !== undefined) throw this.#failure(error);
      this.#refreshed = forge.refreshCapabilities().catch(() => undefined);
      await this.#refreshed;
      try {
        return await run(forge);
      } catch (retried) {
        throw this.#failure(retried);
      }
    }
  }

  /** A verb the forge lacks is a 501, and without a token that may be the reason. */
  #failure(error: unknown): ForgesError {
    if (isUnsupported(error)) {
      const reason = this.#anonymous
        ? `${(error as Error).message} without a token; pass one if this forge serves it to signed-in accounts only`
        : (error as Error).message;
      return new ForgesError(reason, 501, this.#platform, error as Error);
    }
    return normalizeError(toFetchError(error), this.#platform);
  }

  #open(): Promise<Forge> {
    this.#forge ??= Promise.resolve()
      .then(() => this.openForge())
      .catch((error: unknown) => {
        this.#forge = undefined;
        throw this.#failure(error);
      });
    return this.#forge;
  }

  /** Names stay one path segment: a forge decoding `%2F` would route `../admin` elsewhere. */
  protected repoRef(forge: Forge, owner: string, repo: string): RepoRef {
    this.assertRepositoryPath(owner, repo);
    return { forge: forge.forge, instance: forge.instance, owner, name: repo };
  }

  protected assertRepositoryPath(owner: string, repo: string): void {
    this.assertOwnerPath(owner);
    encodePathSegment(repo, "Repository name");
  }

  /** One segment; GitLab lets the owner be a nested group. */
  protected assertOwnerPath(owner: string): void {
    encodePathSegment(owner, "Owner");
  }

  /** The page options `forges` takes for a position this provider handed out. */
  protected forgePageOptions(options: { perPage?: number; at?: PagePosition } | undefined) {
    const at = options?.at;
    const page: ForgePageOptions = {};
    if (options?.perPage !== undefined) page.perPage = options.perPage;
    if (at === undefined) return page;
    if ("url" in at) page.cursor = { nextUrl: at.url };
    else if ("token" in at) page.cursor = { token: at.token };
    else throw new ForgesError("cursor is not one this listing returned", 400, this.#platform);
    return page;
  }

  /** One page of a listing, mapped, with where the next one starts. */
  protected async forgePage<T, U>(
    listing: ForgeListing<T>,
    map: (item: T) => U,
  ): Promise<ContinuedPage<U>> {
    return continuedPage(await listing.page(), map);
  }

  protected override async getRepo(owner: string, repo: string): Promise<Repository> {
    return this.forgeCall(async (forge) =>
      this.mapRepository((await forge.repos.get(this.repoRef(forge, owner, repo))).raw as never),
    );
  }

  protected override async getUser(username: string): Promise<User> {
    encodePathSegment(username, "Username");
    return this.forgeCall(async (forge) =>
      this.mapUser((await forge.users.get(username)).raw as never),
    );
  }

  protected override async getAuthenticatedUser(): Promise<User> {
    return this.forgeCall(async (forge) => this.mapUser((await forge.users.me()).raw as never));
  }

  protected override listReleases(
    owner: string,
    repo: string,
    options?: Positioned<ListReleasesOptions>,
  ): Promise<ContinuedPage<Release>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.releases.list(this.repoRef(forge, owner, repo), this.forgePageOptions(options)),
        (release) => this.mapRelease(release.raw as never),
      ),
    );
  }

  protected override getRelease(owner: string, repo: string, tag: string): Promise<Release> {
    encodeRefPathSegment(tag, "Tag");
    return this.forgeCall(async (forge) =>
      this.mapRelease(
        (await forge.releases.getByTag(this.repoRef(forge, owner, repo), tag)).raw as never,
      ),
    );
  }

  protected override createRelease(
    owner: string,
    repo: string,
    input: CreateReleaseInput,
  ): Promise<Release> {
    return this.forgeCall(async (forge) =>
      this.mapRelease(
        (
          await forge.releases.create(this.repoRef(forge, owner, repo), {
            ...releaseUpdate(input),
            tag: input.tag,
            ...(input.ref === undefined ? {} : { target: input.ref }),
          })
        ).raw as never,
      ),
    );
  }

  /** Forges that edit a release by id need it read by its tag first. */
  protected override updateRelease(
    owner: string,
    repo: string,
    tag: string,
    input: UpdateReleaseInput,
  ): Promise<Release> {
    encodeRefPathSegment(tag, "Tag");
    return this.forgeCall(async (forge) => {
      const release = await forge.releases.getByTag(this.repoRef(forge, owner, repo), tag);
      return this.mapRelease(
        (await forge.releases.update(release.ref, releaseUpdate(input))).raw as never,
      );
    });
  }

  /** GitHub and Gitea name the peeled commit on each tag; a tag on a tree or blob names none. */
  protected override listTags(
    owner: string,
    repo: string,
    options?: Positioned<ListTagsOptions>,
  ): Promise<ContinuedPage<Tag>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.contents.tags(this.repoRef(forge, owner, repo), this.forgePageOptions(options)),
        (tag) => {
          const raw = tag.raw as { name: string; commit?: { sha?: string } };
          return { name: raw.name, sha: raw.commit?.sha || null };
        },
      ),
    );
  }

  protected override listCommits(
    owner: string,
    repo: string,
    options?: Positioned<ListCommitOptions>,
  ): Promise<ContinuedPage<CommitSummary>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.commits.list(this.repoRef(forge, owner, repo), {
          ...this.forgePageOptions(options),
          ...(options?.ref === undefined ? {} : { ref: options.ref }),
          ...(options?.path === undefined ? {} : { path: options.path }),
          ...(options?.since === undefined ? {} : { since: this.#date(options.since, "since") }),
          ...(options?.until === undefined ? {} : { until: this.#date(options.until, "until") }),
        }),
        (commit) => this.mapCommitSummary(commit.raw as never),
      ),
    );
  }

  protected override listCiRuns(
    owner: string,
    repo: string,
    options?: Positioned<ListCiRunsOptions>,
  ): Promise<ContinuedPage<CiRun>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.ci.runs(this.repoRef(forge, owner, repo), {
          ...this.forgePageOptions(options),
          ...(options?.branch === undefined ? {} : { branch: options.branch }),
        }),
        (run) => this.mapCiRun(run.raw as never),
      ),
    );
  }

  protected override listCiJobs(
    owner: string,
    repo: string,
    runId: string,
    options?: Positioned<ListCiJobsOptions>,
  ): Promise<ContinuedPage<CiJob>> {
    return this.forgeCall((forge) => {
      const ref = this.repoRef(forge, owner, repo);
      return this.forgePage(
        forge.ci.jobs(
          { forge: forge.forge, instance: forge.instance, repo: ref, id: runId },
          this.forgePageOptions(options),
        ),
        (job) => this.mapCiJob(job.raw as never),
      );
    });
  }

  /** `forges` takes dates, and a string that isn't one is the caller's to fix. */
  #date(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new ForgesError(`${field} must be an ISO 8601 date`, 400, this.#platform);
    }
    return date;
  }

  /** `forges` drops the pull requests GitHub's issues route serves alongside issues. */
  protected override listIssues(
    owner: string,
    repo: string,
    options?: Positioned<ListOptions>,
  ): Promise<ContinuedPage<Issue>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.threads.list(this.repoRef(forge, owner, repo), {
          ...this.forgePageOptions(options),
          kind: "issue",
          state: options?.state ?? "open",
        }),
        (thread) => this.mapIssue(thread.raw as never),
      ),
    );
  }

  protected override listIssueComments(
    owner: string,
    repo: string,
    number: number,
    options?: Positioned<ListCommentOptions>,
  ): Promise<ContinuedPage<Comment>> {
    return this.#listComments("issue", owner, repo, number, options);
  }

  protected override listPullRequestComments(
    owner: string,
    repo: string,
    number: number,
    options?: Positioned<ListCommentOptions>,
  ): Promise<ContinuedPage<Comment>> {
    return this.#listComments("pull_request", owner, repo, number, options);
  }

  #listComments(
    kind: ThreadKind,
    owner: string,
    repo: string,
    number: number,
    options?: Positioned<ListCommentOptions>,
  ): Promise<ContinuedPage<Comment>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.threads.comments(
          this.threadRef(forge, owner, repo, kind, number),
          this.forgePageOptions(options),
        ),
        (comment) => this.mapComment(comment.raw as never),
      ),
    );
  }

  /** Files carry no forge payload in `forges`, so its model maps them; counts it lacks are null. */
  protected override listPullRequestFiles(
    owner: string,
    repo: string,
    number: number,
    options?: Positioned<ListPullRequestFilesOptions>,
  ): Promise<ContinuedPage<PullRequestFile>> {
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.threads.files(
          this.threadRef(forge, owner, repo, "pull_request", number),
          this.forgePageOptions(options),
        ),
        (file) => ({
          path: file.path,
          status: normalizeChangedFileStatus(file.statusRaw ?? file.status),
          additions: file.additions ?? null,
          deletions: file.deletions ?? null,
        }),
      ),
    );
  }

  protected threadRef(
    forge: Forge,
    owner: string,
    repo: string,
    kind: ThreadKind,
    number: number,
  ): ThreadRef {
    return {
      forge: forge.forge,
      instance: forge.instance,
      repo: this.repoRef(forge, owner, repo),
      kind,
      number: String(number),
    };
  }

  protected listOwnerRepos(
    owner: string,
    options?: Positioned<ListOptions>,
  ): Promise<ContinuedPage<Repository>> {
    this.assertOwnerPath(owner);
    return this.forgeCall((forge) =>
      this.forgePage(
        forge.repos.byOwner(
          { forge: forge.forge, instance: forge.instance, owner, name: "" },
          this.forgePageOptions(options),
        ),
        (repo) => this.mapRepository(repo.raw as never),
      ),
    );
  }
}

/** The release fields a caller set, leaving out the ones it did not. */
export function releaseUpdate(input: UpdateReleaseInput) {
  return Object.fromEntries(
    (["name", "body", "draft", "prerelease"] as const)
      .filter((field) => input[field] !== undefined)
      .map((field) => [field, input[field]]),
  ) as Pick<UpdateReleaseInput, "name" | "body" | "draft" | "prerelease">;
}

/** Maps a `forges` page and carries its continuation as a position. */
export function continuedPage<T, U>(page: Page<T>, map: (item: T) => U): ContinuedPage<U> {
  const next = positionOf(page.cursor);
  return {
    items: page.items.map(map),
    ...(page.total === undefined ? {} : { totalCount: page.total }),
    ...(next === undefined ? {} : { next }),
  };
}

function positionOf(cursor: Cursor | undefined): PagePosition | undefined {
  if (cursor?.nextUrl) return { url: cursor.nextUrl };
  if (cursor?.token) return { token: cursor.token };
  return undefined;
}

function isUnsupported(error: unknown): boolean {
  return error instanceof Error && error.name === "UnsupportedOperationError";
}

/**
 * Tangled provider implementation
 * atproto on tangled.org, built on `forges/tangled`, with key differences:
 * - An owner is a handle or a DID, and a repository id is the repository's DID
 * - Writes sign in with a handle or DID and an app password, not a token
 * - Git reads go through the public mirror at api.tangled.org, one tree level at a time
 */

import {
  NotFoundError as ForgeNotFoundError,
  type Comparison,
  type ForgeProvider as Forge,
  type Repo,
  type RepoRef as ForgeRepoRef,
  type TreeEntry,
} from "forges";
import { tangled } from "forges/tangled";

import { ForgeBackedProvider, type ForgeOptions } from "./forge.ts";
import {
  changedFileFromModel,
  commitSummaryFromModel,
  repositoryFromModel,
} from "./forge-model.ts";
import { ForgesError, NotFoundError, normalizeError } from "../errors.ts";
import { slicePage } from "../pagination.ts";
import { assertProviderConfig } from "../provider-config.ts";
import type { ContinuedPage, Numbered, Positioned, WithPage } from "../provider.ts";
import {
  assertContinuationRef,
  assertFileSize,
  buildRepositoryFileFromBytes,
  isCommitSha,
  unreadableEntry,
} from "../repository-contents.ts";
import type {
  CommitComparison,
  CommitSummary,
  CompareCommitsOptions,
  ListCommitOptions,
  ProviderConfig,
  RepoRef,
  Repository,
  RepositoryContents,
  RepositoryContentsOptions,
  RepositoryEntry,
} from "../types.ts";

const PLATFORM = "tangled";

/** One path of a repository at one commit. */
type TreeAt = Readonly<{ repo: ForgeRepoRef; sha: string; path: string }>;

function noPath(path: string): NotFoundError {
  return new NotFoundError(`No file or directory at ${path}`, { platform: PLATFORM });
}

function entryOf(entry: Readonly<TreeEntry>): RepositoryEntry {
  return {
    name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
    path: entry.path,
    type: entry.type,
    size: entry.size ?? null,
  };
}

/** Tangled on the shared `forges` mapping, plus repository contents and comparisons. */
export class TangledProvider extends ForgeBackedProvider {
  readonly #identifier: string | undefined;

  /**
   * Create a Tangled provider.
   *
   * @param config Provider configuration. `baseURL` defaults to `https://tangled.org`.
   * `token` is an app password for the handle or DID in `username`.
   */
  constructor(config: ProviderConfig) {
    assertProviderConfig(config, PLATFORM);
    if (config.token && !config.username?.trim()) {
      throw new ForgesError(
        "A Tangled app password needs the handle or DID it signs in as. Pass { username } or set TANGLED_HANDLE",
        { status: 400, platform: PLATFORM },
      );
    }
    super(PLATFORM, {
      apiBaseURL: (config.baseURL || "https://tangled.org").replace(/\/+$/, ""),
      token: config.token ?? "",
    });
    this.#identifier = config.username?.trim() || undefined;
  }

  /** Without a password every read goes anonymous. */
  protected override createForge(options: ForgeOptions): Forge {
    const { auth } = options;
    const identifier = this.#identifier;
    return tangled({
      ...options,
      auth:
        auth.type === "token" && identifier !== undefined
          ? { type: "app_password", identifier, password: auth.token }
          : { type: "anonymous" },
    }) as Forge;
  }

  /** The owner keeps its handle, since `forges` puts the DID in `owner`. */
  protected override mapRepository(repo: Repo): Repository {
    const mapped = repositoryFromModel(repo);
    const owner = repo.ref.ownerHandle ?? mapped.owner.login;
    const parent = repo.parent;
    return {
      ...mapped,
      fullName: `${owner}/${repo.ref.name}`,
      parent:
        parent === undefined
          ? null
          : { fullName: `${parent.ownerHandle ?? parent.owner}/${parent.name}`, url: "" },
    };
  }

  /** The mirror filters commits by ref and path only. */
  protected override listCommits(
    repo: RepoRef,
    options?: Positioned<ListCommitOptions>,
  ): Promise<ContinuedPage<CommitSummary>> {
    const ignored = (["since", "until"] as const).filter((field) => options?.[field] !== undefined);
    if (ignored.length > 0) {
      return Promise.reject(
        new ForgesError(
          `Tangled filters commits by ref and path only. Drop ${ignored.join(", ")}`,
          {
            status: 501,
            platform: PLATFORM,
          },
        ),
      );
    }
    return super.listCommits(repo, options);
  }

  /** A directory or a file, both read at one commit. */
  protected override async readRepositoryContents(
    ref: RepoRef,
    { path, ...options }: RepositoryContentsOptions & { path: string },
  ): Promise<RepositoryContents> {
    try {
      return await this.forgeCall(async (forge) => {
        const repo = this.repoRef(forge, ref);
        const sha = isCommitSha(options.ref)
          ? options.ref
          : await forge.contents.resolveRef(repo, options.ref ?? "HEAD");
        assertContinuationRef(options, sha);
        const at = { repo, sha };
        const entry = path === "" ? undefined : await this.#entry(forge, { ...at, path });
        if (entry === undefined || entry.type === "directory") {
          const entries = await this.#entries(forge, { ...at, path });
          return { type: "directory", path, sha, entries, entriesComplete: true };
        }
        if (entry.type !== "file") throw unreadableEntry(path, entry.type);
        assertFileSize(path, entry.size ?? 0);
        const file = await forge.contents.getFile(repo, path, { ref: sha, as: "binary" });
        return buildRepositoryFileFromBytes(
          { path, sha, bytes: file.content as Uint8Array },
          options,
        );
      });
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /** One level of a directory; the mirror never lists deeper. */
  async #entries(forge: Forge, at: TreeAt): Promise<RepositoryEntry[]> {
    const page = await forge.contents.tree(at.repo, { ref: at.sha, path: at.path }).page();
    return page.items.map(entryOf);
  }

  /** The path as its parent lists it, size included. */
  async #entry(forge: Forge, at: TreeAt): Promise<RepositoryEntry> {
    const parent = at.path.includes("/") ? at.path.slice(0, at.path.lastIndexOf("/")) : "";
    const entries = await this.#entries(forge, { ...at, path: parent }).catch((error: unknown) => {
      throw error instanceof ForgeNotFoundError ? noPath(at.path) : error;
    });
    const entry = entries.find((candidate) => candidate.path === at.path);
    if (entry === undefined) throw noPath(at.path);
    return entry;
  }

  /** The range comes from `format-patch`, which only knows the head side. */
  protected override async compareCommits(
    ref: RepoRef,
    { base, head, ...options }: WithPage<CompareCommitsOptions> & { base: string; head: string },
  ): Promise<Numbered<CommitComparison>> {
    try {
      const comparison: Comparison = await this.forgeCall((forge) =>
        forge.contents.compare(this.repoRef(forge, ref), base, head),
      );
      const commits = comparison.commits.map(commitSummaryFromModel);
      const page = options.page ?? 1;
      return {
        ...slicePage(commits, { page, perPage: options.perPage }),
        totalCount: commits.length,
        status: null,
        aheadBy: comparison.aheadBy ?? commits.length,
        behindBy: null,
        mergeBaseSha: comparison.mergeBaseSha ?? null,
        files: page === 1 ? comparison.files.map(changedFileFromModel) : null,
        filesComplete: null,
      };
    } catch (error) {
      const failure = normalizeError(error, PLATFORM);
      if (failure.status !== 413) throw failure;
      throw new ForgesError(
        `The mirror refuses to diff ${base}...${head}, the range is too large. Compare refs closer together`,
        { status: 413, platform: PLATFORM, originalError: failure },
      );
    }
  }
}

/**
 * GitCafe provider implementation
 * REST on git.cafe/api, built on `forges/gitcafe`, with key differences:
 * - Ids are prefixed strings such as `repo_01kt…`, numbers only for issues and pull requests
 * - Lists page on the `next` token in the body, never on a page number
 * - The commit log filters by ref alone, and a comparison lists files without commits
 */

import type { ForgeProvider as Forge } from "forges";
import { gitcafe } from "forges/gitcafe";

import { ForgeBackedProvider, type ForgeOptions } from "./forge.ts";
import { encodePathSegment, normalizeApiBaseURL } from "./base-url.ts";
import { FetchError, ForgesError, normalizeError } from "../errors.ts";
import {
  assertContinuationRef,
  assertFileSize,
  buildRepositoryFileFromBytes,
  isCommitSha,
} from "../repository-contents.ts";
import type { ContinuedPage, NumberedPage, Positioned } from "../provider.ts";
import type {
  CiRun,
  CommitSummary,
  ListCiRunsOptions,
  ListCommitOptions,
  ListOptions,
  ProviderConfig,
  RepoRef,
  Repository,
  RepositoryContents,
  RepositoryContentsOptions,
  RepositoryEntry,
} from "../types.ts";

const PLATFORM = "gitcafe";

/** `/explore/repos` refuses a `limit` above 50 with a 400. */
const MAX_REPOS_PER_PAGE = 50;

/** Rows one directory read asks for, the most `/tree` serves. */
const TREE_PAGE = 200;

/** Pages read before a directory listing is called incomplete. */
const MAX_TREE_PAGES = 10;

/** One row of `/tree`. */
interface GitCafeTreeEntry {
  name: string;
  path: string;
  kind: "blob" | "tree" | "commit" | "symlink";
}

interface GitCafeTreePage {
  items: GitCafeTreeEntry[];
  next: string | null;
}

/** `/blob`, with `content` null for a binary file. */
interface GitCafeBlob {
  size: number;
  content: string | null;
}

/** The part of GitCafe's error body that names the failure. */
interface GitCafeProblem {
  code?: string;
}

const ENTRY_TYPES = {
  blob: "file",
  tree: "directory",
  commit: "submodule",
  symlink: "symlink",
} as const;

function entryOf(raw: Readonly<GitCafeTreeEntry>): RepositoryEntry {
  return { name: raw.name, path: raw.path, type: ENTRY_TYPES[raw.kind], size: null };
}

/** `/blob` answers a directory with a 400 `invalid`. */
function isWrongKind(error: unknown): boolean {
  if (!(error instanceof FetchError) || error.status !== 400) return false;
  return (error.data as GitCafeProblem | undefined)?.code === "invalid";
}

/** GitCafe on the shared `forges` mapping, plus repository contents. */
export class GitCafeProvider extends ForgeBackedProvider {
  /**
   * Create a GitCafe provider.
   *
   * @param config Provider configuration. `baseURL` defaults to `https://git.cafe/api`.
   */
  constructor(config: ProviderConfig) {
    super(PLATFORM, {
      apiBaseURL: normalizeApiBaseURL(config.baseURL, {
        fallbackBaseURL: "https://git.cafe/api",
        apiPath: "/api",
      }),
      token: config.token ?? "",
    });
  }

  protected override createForge(options: ForgeOptions): Forge {
    return gitcafe(options) as Forge;
  }

  #repoPath({ owner, repo }: RepoRef): string {
    return `/repos/${encodePathSegment(owner, "Owner")}/${encodePathSegment(repo, "Repository name")}`;
  }

  protected override listRepos(
    owner: string,
    options?: Positioned<ListOptions>,
  ): Promise<ContinuedPage<Repository>> {
    if ((options?.perPage ?? 0) > MAX_REPOS_PER_PAGE) {
      return Promise.reject(
        new ForgesError(`GitCafe lists ${MAX_REPOS_PER_PAGE} repositories a page at most`, {
          status: 400,
          platform: PLATFORM,
        }),
      );
    }
    return super.listRepos(owner, options);
  }

  /** `/commits` takes a ref, nothing else. */
  protected override listCommits(
    repo: RepoRef,
    options?: Positioned<ListCommitOptions>,
  ): Promise<ContinuedPage<CommitSummary>> {
    const ignored = (["path", "since", "until"] as const).filter(
      (field) => options?.[field] !== undefined,
    );
    if (ignored.length > 0) {
      return Promise.reject(
        new ForgesError(`GitCafe filters commits by ref only. Drop ${ignored.join(", ")}`, {
          status: 501,
          platform: PLATFORM,
        }),
      );
    }
    return super.listCommits(repo, options);
  }

  /** `/actions/runs` filters by branch, never by workflow. */
  protected override listCiRuns(
    repo: RepoRef,
    options?: Positioned<ListCiRunsOptions>,
  ): Promise<ContinuedPage<CiRun> | NumberedPage<CiRun>> {
    if (options?.workflow !== undefined) {
      return Promise.reject(
        new ForgesError("GitCafe filters CI runs by branch only. Drop workflow", {
          status: 501,
          platform: PLATFORM,
        }),
      );
    }
    return super.listCiRuns(repo, options);
  }

  /** A file through `/blob`, a directory through `/tree`, both at one commit. */
  protected override async readRepositoryContents(
    ref: RepoRef,
    { path, ...options }: RepositoryContentsOptions & { path: string },
  ): Promise<RepositoryContents> {
    try {
      const sha = isCommitSha(options.ref)
        ? options.ref
        : await this.forgeCall((forge) =>
            forge.contents.resolveRef(this.repoRef(forge, ref), options.ref ?? "HEAD"),
          );
      assertContinuationRef(options, sha);
      if (path === "") return await this.#directory(ref, { path, sha });
      try {
        return await this.#file(ref, { path, sha, options });
      } catch (error) {
        if (!isWrongKind(error)) throw error;
        return await this.#directory(ref, { path, sha });
      }
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  async #file(
    ref: RepoRef,
    {
      path,
      sha,
      options,
    }: Readonly<{ path: string; sha: string; options: RepositoryContentsOptions }>,
  ): Promise<RepositoryContents> {
    const route = this.#repoPath(ref);
    const blob = await this.client<GitCafeBlob>(`${route}/blob`, { query: { oid: sha, path } });
    assertFileSize(path, blob.size);
    const bytes =
      blob.content === null
        ? new Uint8Array(
            await this.client<ArrayBuffer, "arrayBuffer">(`${route}/raw`, {
              query: { oid: sha, path },
              responseType: "arrayBuffer",
            }),
          )
        : new TextEncoder().encode(blob.content);
    return buildRepositoryFileFromBytes({ path, sha, bytes }, options);
  }

  async #directory(
    ref: RepoRef,
    { path, sha }: Readonly<{ path: string; sha: string }>,
  ): Promise<RepositoryContents> {
    const entries: RepositoryEntry[] = [];
    let after: string | null | undefined;
    for (let page = 0; page < MAX_TREE_PAGES; page++) {
      const listing = await this.client<GitCafeTreePage>(`${this.#repoPath(ref)}/tree`, {
        query: { oid: sha, path: path || undefined, limit: TREE_PAGE, after },
      });
      entries.push(...listing.items.map(entryOf));
      after = listing.next;
      if (after === null) return { type: "directory", path, sha, entries, entriesComplete: true };
    }
    return { type: "directory", path, sha, entries, entriesComplete: false };
  }
}

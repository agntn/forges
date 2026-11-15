/**
 * Gitee provider implementation
 * API v5 on gitee.com, built on `forges/gitee`, with key differences:
 * - An issue goes by a text key such as `I8ZQ2A`, a pull request by its number
 * - A missing path under `/contents` answers 200 with an empty list, not 404
 * - The enterprise edition at e.gitee.com is out of reach
 */

import type { ForgeProvider as Forge } from "forges";
import { gitee } from "forges/gitee";

import { ForgeBackedProvider, type ForgeOptions } from "./forge.ts";
import { commitSummaryFromModel, changedFileFromModel } from "./forge-model.ts";
import { encodePathSegment, normalizeApiBaseURL } from "./base-url.ts";
import { NotFoundError, normalizeError } from "../errors.ts";
import {
  assertContinuationRef,
  buildRepositoryFile,
  contentsEntryType,
  encodeRepositoryPath,
  isCommitSha,
  unreadableEntry,
} from "../repository-contents.ts";
import { slicePage } from "../pagination.ts";
import type { Numbered, WithPage } from "../provider.ts";
import type {
  CommitComparison,
  CompareCommitsOptions,
  ProviderConfig,
  RepoRef,
  Repository,
  RepositoryContents,
  RepositoryContentsOptions,
} from "../types.ts";

const PLATFORM = "gitee";

/** One entry of a `/contents` read, a file with its bytes or a directory row. */
interface GiteeContent {
  type: "file" | "dir" | "symlink" | "submodule";
  name: string;
  path: string;
  size?: number | null;
  encoding?: string;
  content?: string;
}

/**
 * Gitee on the shared `forges` mapping, plus repository contents and comparisons,
 * which the base leaves out. CI runs and other forges' extras answer 501.
 */
export class GiteeProvider extends ForgeBackedProvider {
  /**
   * Create a Gitee provider.
   *
   * @param config Provider configuration. `baseURL` defaults to `https://gitee.com/api/v5`.
   */
  constructor(config: ProviderConfig) {
    super(PLATFORM, {
      apiBaseURL: normalizeApiBaseURL(config.baseURL, {
        fallbackBaseURL: "https://gitee.com/api/v5",
        apiPath: "/api/v5",
      }),
      token: config.token ?? "",
      issueKeys: true,
    });
  }

  protected override createForge(options: ForgeOptions): Forge {
    return gitee(options) as Forge;
  }

  /** `forges` appends `.git` to an `html_url` that already ends in it. */
  protected override mapRepository(repo: never): Repository {
    const mapped = super.mapRepository(repo);
    return { ...mapped, cloneUrl: mapped.cloneUrl.replace(/\.git\.git$/, ".git") };
  }

  #repoPath({ owner, repo }: RepoRef): string {
    return `/repos/${encodePathSegment(owner, "Owner")}/${encodePathSegment(repo, "Repository name")}`;
  }

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
      const contents = await this.client<GiteeContent[] | GiteeContent>(
        `${this.#repoPath(ref)}/contents${path === "" ? "" : `/${encodeRepositoryPath(path)}`}`,
        { query: { ref: sha } },
      );
      if (Array.isArray(contents)) {
        if (contents.length === 0 && path !== "") {
          throw new NotFoundError(`No file or directory at ${path}`, { platform: PLATFORM });
        }
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
      return buildRepositoryFile({ path, sha, base64: contents.content ?? "" }, options);
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }

  /** Gitee lists 100 commits at most and says so with `truncated`; then the counts stay a floor. */
  protected override async compareCommits(
    ref: RepoRef,
    { base, head, ...options }: WithPage<CompareCommitsOptions> & { base: string; head: string },
  ): Promise<Numbered<CommitComparison>> {
    try {
      const comparison = await this.forgeCall((forge) =>
        forge.contents.compare(this.repoRef(forge, ref), base, head),
      );
      const commits = comparison.commits.map(commitSummaryFromModel).toReversed();
      const page = options.page ?? 1;
      const complete = (comparison.raw as { truncated?: boolean }).truncated !== true;
      return {
        ...slicePage(commits, { page, perPage: options.perPage }),
        totalCount: commits.length,
        status: null,
        aheadBy: comparison.aheadBy ?? commits.length,
        behindBy: null,
        mergeBaseSha:
          (comparison.raw as { merge_base_commit?: { sha?: string } }).merge_base_commit?.sha ??
          null,
        files: page === 1 ? comparison.files.map(changedFileFromModel) : null,
        filesComplete: complete ? true : null,
      };
    } catch (error) {
      throw normalizeError(error, PLATFORM);
    }
  }
}

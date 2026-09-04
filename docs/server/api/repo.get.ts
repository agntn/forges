import type { Repository } from "@agntn/forges";

/** One repository as `repos.get` returns it; `viewerPermission` is the worker's role, so it is dropped. */
export interface RepoAnswer {
  platform: Platform;
  repository: Omit<Repository, "viewerPermission">;
  fetchedAt: string;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const platform = readPlatform(query);
  const owner = readName(query, "owner");
  const repo = readName(query, "repo");
  const host = readHost(query, platform);
  const params = { platform, host, owner, repo };
  try {
    return await cachedAnswer<RepoAnswer>(event, "repo", params, TTL.repo, async () => {
      const { viewerPermission: _viewer, ...repository } = await forge(platform, host).repos.get(
        owner,
        repo,
      );
      return { platform, repository, fetchedAt: new Date().toISOString() };
    });
  } catch (error) {
    return toHttpError(error);
  }
});

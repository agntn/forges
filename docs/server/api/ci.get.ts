/** One page of CI runs as `ciRuns.list` returns it: GitHub Actions runs, GitLab pipelines or Gitea Actions runs. */
export interface CiAnswer {
  platform: Platform;
  items: WireCiRun[];
  hasNextPage: boolean;
  fetchedAt: string;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const platform = readPlatform(query);
  const owner = readName(query, "owner");
  const repo = readName(query, "repo");
  const host = readHost(query, platform);
  const perPage = readInt(query, "perPage", 1, LIMITS.perPage) ?? 5;
  const params = { platform, host, owner, repo, perPage };
  try {
    return await cachedAnswer<CiAnswer>(event, "ci", params, TTL.list, async () => {
      const page = await forge(platform, host).ciRuns.list(owner, repo, { perPage });
      return {
        platform,
        items: page.items.map(slimCiRun),
        hasNextPage: page.hasNextPage,
        fetchedAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    return toHttpError(error);
  }
});

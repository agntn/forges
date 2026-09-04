/** One page of pull requests as `pullRequests.list` returns it, without bodies. */
export interface PullsAnswer {
  platform: Platform;
  items: WirePullRequest[];
  hasNextPage: boolean;
  fetchedAt: string;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const platform = readPlatform(query);
  const owner = readName(query, "owner");
  const repo = readName(query, "repo");
  const host = readHost(query, platform);
  const state = readState(query);
  const perPage = readInt(query, "perPage", 1, LIMITS.perPage) ?? 5;
  const params = { platform, host, owner, repo, state, perPage };
  try {
    return await cachedAnswer<PullsAnswer>(event, "pulls", params, TTL.list, async () => {
      const page = await forge(platform, host).pullRequests.list(owner, repo, { state, perPage });
      return {
        platform,
        items: page.items.map(slimPullRequest),
        hasNextPage: page.hasNextPage,
        fetchedAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    return toHttpError(error);
  }
});

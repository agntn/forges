/** One page of commits as `commits.list` returns it: metadata only, no files, no patches. */
export interface CommitsAnswer {
  platform: Platform;
  items: WireCommit[];
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
    return await cachedAnswer<CommitsAnswer>(event, "commits", params, TTL.list, async () => {
      const page = await forge(platform, host).commits.list(owner, repo, { perPage });
      return {
        platform,
        items: page.items.map(slimCommit),
        hasNextPage: page.hasNextPage,
        fetchedAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    return toHttpError(error);
  }
});

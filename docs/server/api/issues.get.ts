/** One page of issues as `issues.list` returns it, without bodies. */
export interface IssuesAnswer {
  platform: Platform;
  items: WireIssue[];
  hasNextPage: boolean;
  totalCount: number | null;
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
    return await cachedAnswer<IssuesAnswer>(event, "issues", params, TTL.list, async () => {
      const page = await forge(platform, host).issues.list(owner, repo, { state, perPage });
      return {
        platform,
        items: page.items.map(slimIssue),
        hasNextPage: page.hasNextPage,
        totalCount: page.totalCount ?? null,
        fetchedAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    return toHttpError(error);
  }
});

/** One page of review threads of a pull request as `threads.list` returns it, comments bounded. */
export interface ThreadsAnswer {
  platform: Platform;
  number: number;
  items: WireThread[];
  hasNextPage: boolean;
  fetchedAt: string;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const platform = readPlatform(query);
  const owner = readName(query, "owner");
  const repo = readName(query, "repo");
  const host = readHost(query, platform);
  const number = readInt(query, "number", 1, 10_000_000);
  if (number === undefined) {
    throw createError({ statusCode: 400, statusMessage: "number is required" });
  }
  const perPage = readInt(query, "perPage", 1, LIMITS.threadsPerPage) ?? LIMITS.threadsPerPage;
  const params = { platform, host, owner, repo, number, perPage };
  try {
    return await cachedAnswer<ThreadsAnswer>(event, "threads", params, TTL.threads, async () => {
      const page = await forge(platform, host).threads.list(owner, repo, number, {
        perPage,
        state: "all",
      });
      return {
        platform,
        number,
        items: page.items.map(slimThread),
        hasNextPage: page.hasNextPage,
        fetchedAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    return toHttpError(error);
  }
});

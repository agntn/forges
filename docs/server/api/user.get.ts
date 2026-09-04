import type { User } from "@agntn/forges";

/** One profile as `users.get` returns it, without the email the platform may attach. */
export interface UserAnswer {
  platform: Platform;
  user: Omit<User, "email" | "isAdmin">;
  fetchedAt: string;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const platform = readPlatform(query);
  const username = readName(query, "username");
  const params = { platform, username };
  try {
    return await cachedAnswer<UserAnswer>(event, "user", params, TTL.user, async () => {
      const { email: _email, isAdmin: _admin, ...user } = await forge(platform).users.get(username);
      return { platform, user, fetchedAt: new Date().toISOString() };
    });
  } catch (error) {
    return toHttpError(error);
  }
});

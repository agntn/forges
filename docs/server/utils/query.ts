import type { H3Event } from "h3";
import { hash } from "ohash";
import {
  AuthenticationError,
  ForgesError,
  NotFoundError,
  PermissionError,
  RateLimitError,
} from "@agntn/forges";

type Query = Record<string, unknown>;

/** Caps every public parameter well below anything a platform would mind. */
export const LIMITS = {
  name: 100,
  query: 200,
  perPage: 10,
  /** Review threads keep every comment of the page, so the page stays small. */
  threadsPerPage: 5,
} as const;

/** Seconds an answer stays cached, per operation. */
export const TTL = {
  repo: 15 * 60,
  list: 10 * 60,
  threads: 10 * 60,
  user: 30 * 60,
  platforms: 5 * 60,
} as const;

function raw(query: Query, key: string): string | undefined {
  const value = query[key];
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

export function readString(query: Query, key: string, max: number): string | undefined {
  const value = raw(query, key)?.trim();
  if (!value) {
    return undefined;
  }
  if (value.length > max) {
    throw createError({
      statusCode: 400,
      statusMessage: `${key} must be at most ${max} characters`,
    });
  }
  return value;
}

export function requireString(query: Query, key: string, max: number): string {
  const value = readString(query, key, max);
  if (!value) {
    throw createError({ statusCode: 400, statusMessage: `${key} is required` });
  }
  return value;
}

export function readInt(query: Query, key: string, min: number, max: number): number | undefined {
  const value = raw(query, key);
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw createError({
      statusCode: 400,
      statusMessage: `${key} must be an integer between ${min} and ${max}`,
    });
  }
  return parsed;
}

/** A repository owner or name as the platforms accept it: letters, digits, dots, dashes and underscores. */
export function readName(query: Query, key: string): string {
  const value = requireString(query, key, LIMITS.name);
  if (!/^[\w.-]+$/u.test(value) || value === "." || value === "..") {
    throw createError({
      statusCode: 400,
      statusMessage: `${key} must be a repository owner or name`,
    });
  }
  return value;
}

/** `open`, `closed` or `all`; anything else is a 400. */
export function readState(query: Query): "open" | "closed" | "all" {
  const value = readString(query, "state", 8) ?? "open";
  if (value !== "open" && value !== "closed" && value !== "all") {
    throw createError({ statusCode: 400, statusMessage: "state must be open, closed or all" });
  }
  return value;
}

/** Stable cache key from the parameters that reach the library, so two spellings of one request share an entry. */
export function cacheKey(prefix: string, params: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `${prefix}:${JSON.stringify(entries)}`;
}

/** The part of a message before the first `:` or `[`, so an endpoint or a response body never reaches the page. */
export function failureText(message: string): string {
  const head = message.split(/[:[{]/u, 2)[0]?.trim() || message;
  const points = [...head];
  return points.length > 160 ? `${points.slice(0, 159).join("").trimEnd()}…` : head;
}

/** Turns a library error into the status the browser can show; the typed hierarchy decides the code. */
export function toHttpError(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    !(error instanceof ForgesError)
  ) {
    throw error;
  }
  if (error instanceof NotFoundError) {
    throw createError({
      statusCode: 404,
      statusMessage: `${error.platform} answered 404: no such repository, issue or user, or it is private`,
    });
  }
  if (error instanceof AuthenticationError) {
    throw createError({
      statusCode: 503,
      statusMessage: `${error.platform} wants a token for this call and the docs worker has none`,
    });
  }
  if (error instanceof PermissionError) {
    throw createError({
      statusCode: 403,
      statusMessage: `${error.platform} refused the docs worker's access`,
    });
  }
  if (error instanceof RateLimitError) {
    const retry = error.retryAfter ? ` Retry after ${error.retryAfter}s.` : "";
    throw createError({
      statusCode: 429,
      statusMessage: `${error.platform} is rate limiting the docs worker.${retry}`,
    });
  }
  if (error instanceof ForgesError) {
    const status = error.status ? ` HTTP ${error.status}.` : "";
    throw createError({
      statusCode: 502,
      statusMessage: `${error.platform ?? "The platform"} failed: ${failureText(error.message)}.${status}`,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  throw createError({ statusCode: 502, statusMessage: failureText(message) });
}

export function markPublic(event: H3Event, seconds: number): void {
  setResponseHeader(
    event,
    "Cache-Control",
    `public, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`,
  );
}

/** Uncached platform requests one client may start per minute; cache hits are free. */
export const RATE_LIMIT = 30;

/** Counts uncached requests per client and minute; cache hits are free, so a warm demo never trips it. */
export async function assertRateLimit(event: H3Event): Promise<void> {
  const ip =
    getRequestIP(event, { xForwardedFor: true }) ??
    getRequestHeader(event, "cf-connecting-ip") ??
    "unknown";
  const minute = Math.floor(Date.now() / 60_000);
  const key = `docs:rate:${hash(ip)}:${minute}`;
  const storage = useStorage("cache");
  const count = Number((await storage.getItem<number>(key).catch(() => 0)) ?? 0) + 1;
  await storage.setItem(key, count, { ttl: 120 }).catch(() => undefined);
  if (count > RATE_LIMIT) {
    setResponseHeader(event, "Retry-After", String(60 - (Math.floor(Date.now() / 1000) % 60)));
    throw createError({
      statusCode: 429,
      statusMessage: `More than ${RATE_LIMIT} new platform requests in a minute from one address; cached answers are not counted. Wait a moment.`,
    });
  }
}

interface CachedEntry<T> {
  value: T;
  expires: number;
}

/** Serves from the cache or produces and stores; a thrown failure is never stored. */
export async function cachedAnswer<T>(
  event: H3Event,
  prefix: string,
  params: Readonly<Record<string, unknown>>,
  ttl: number,
  produce: () => Promise<T>,
): Promise<T> {
  const storage = useStorage("cache");
  const key = `docs:${prefix}:${hash(cacheKey(prefix, params))}`;
  const hit = await storage.getItem<CachedEntry<T>>(key).catch(() => null);
  if (hit && typeof hit.expires === "number" && hit.expires > Date.now()) {
    markPublic(event, Math.max(1, Math.floor((hit.expires - Date.now()) / 1000)));
    return hit.value;
  }
  await assertRateLimit(event);
  const value = await produce();
  await storage.setItem(key, { value, expires: Date.now() + ttl * 1000 }).catch(() => undefined);
  markPublic(event, ttl);
  return value;
}

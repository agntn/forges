/**
 * Cache layer using unstorage with lru-cache driver
 * Provides caching for HTTP requests with TTL support; the memory driver has no TTL
 */

import { createStorage, type Storage } from "unstorage";
import lruCacheDriver from "unstorage/drivers/lru-cache";
import type { HttpClient } from "./http.ts";

/**
 * Options for cache creation
 */
export interface CacheOptions {
  max?: number; // Maximum number of items in cache (default: 500)
  ttl?: number; // Time to live in milliseconds (default: 300000 = 5 minutes)
}

/**
 * Options for cachedFetch
 */
export interface CachedFetchOptions {
  method?: string;
  [key: string]: unknown;
}

/** One request for {@link cachedFetch}: the URL and the options the client takes with it. */
export interface CachedRequest extends CachedFetchOptions {
  url: string;
}

/** The URL apart from its options, which stay undefined when there are none. */
function splitRequest(
  request: CachedRequest,
  call: string,
): { url: string; options?: CachedFetchOptions } {
  if (typeof request !== "object" || request === null || typeof request.url !== "string") {
    throw new TypeError(`${call} takes { url, ...options } as its second argument`);
  }
  const { url, ...options } = request;
  return Object.keys(options).length === 0 ? { url } : { url, options };
}

/**
 * Key under which an HTTP client carries its cache scope.
 *
 * Cache storage is process-global, so entries must be separated by API origin
 * and credential identity. Without it two clients pointed at different hosts,
 * or at one host with different tokens, read each other's responses.
 */
export const CACHE_SCOPE: unique symbol = Symbol.for("forges.cacheScope");

type ScopedClient = HttpClient & { [CACHE_SCOPE]?: string };

function clientCacheScope(client: HttpClient): string {
  return (client as ScopedClient)[CACHE_SCOPE] ?? "";
}

/**
 * Global cache storage instance
 */
let globalStorage: Storage | null = null;

/**
 * Create a cache storage with lru-cache driver
 * @param options Cache configuration
 * @returns Storage instance
 */
export function createCache(options?: CacheOptions): Storage {
  const { max = 500, ttl = 300000 } = options || {};

  return createStorage({
    driver: lruCacheDriver({
      max,
      ttl,
    }),
  });
}

/**
 * Configure global storage for custom implementations (Redis, FS, etc.)
 * @param storage Custom storage instance
 */
export function configureStorage(storage: Storage): void {
  globalStorage = storage;
}

/**
 * Get or initialize global storage
 */
function getStorage(): Storage {
  if (!globalStorage) {
    globalStorage = createCache();
  }
  return globalStorage;
}

/**
 * Generate cache key from URL and query parameters
 * @param scope Client the response belongs to
 * @param request Request URL and options
 * @returns Cache key
 */
function generateCacheKey(
  scope: string,
  request: { url: string; options?: CachedFetchOptions },
): string {
  const { url, options } = request;
  let key = `cache:${scope}:${url}`;

  // Include query parameters in cache key if present
  if (options?.query) {
    const queryStr = serializeQueryForCache(options.query);
    if (queryStr) {
      key += `:query:${queryStr}`;
    }
  }

  return key;
}

function serializeQueryForCache(query: unknown): string {
  if (typeof query === "string") {
    return serializeQueryEntries(
      new URLSearchParams(query.startsWith("?") ? query.slice(1) : query).entries(),
    );
  }

  if (query instanceof URLSearchParams) {
    return serializeQueryEntries(query.entries());
  }

  if (Array.isArray(query)) {
    return serializeQueryEntries(query);
  }

  const params = new URLSearchParams();
  for (const key of Object.keys(query as Record<string, unknown>).sort()) {
    const value = (query as Record<string, unknown>)[key];
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
      continue;
    }

    params.append(key, String(value));
  }

  return params.toString();
}

function serializeQueryEntries(entries: Iterable<[string, string]>): string {
  return new URLSearchParams(Array.from(entries).sort(compareQueryEntries)).toString();
}

function compareQueryEntries(
  [leftKey, _leftValue]: [string, string],
  [rightKey, _rightValue]: [string, string],
): number {
  return leftKey.localeCompare(rightKey);
}

/**
 * Wrapper around HTTP client that caches GET requests. A storage that fails to
 * read or write costs the call its cache, never the platform's answer. Only stable
 * item reads use it: repository, issue, pull request, release, discussion comment
 * and user reads call the client directly, because callers act on their current state.
 * @param client HTTP client
 * @param request Request URL with the options the client takes
 * @returns Cached or fresh response
 */
export async function cachedFetch<T>(client: HttpClient, request: CachedRequest): Promise<T> {
  const { url, options } = splitRequest(request, "cachedFetch");
  const method = (options?.method || "GET").toUpperCase();

  // Only cache GET requests
  if (method !== "GET") {
    return client<T>(url, options);
  }

  const storage = getStorage();
  const cacheKey = generateCacheKey(clientCacheScope(client), { url, options });

  // Check cache first
  const slot = { key: cacheKey, url };
  const cached = await readCached<T>(storage, slot);
  if (cached !== null && cached !== undefined) {
    return cached;
  }

  // Cache miss: fetch from client
  const result = options ? await client<T>(url, options) : await client<T>(url);

  // Store in cache
  await writeCached(storage, { ...slot, value: result });

  return result;
}

/** Where one response lives in storage, and the URL a warning about it names. */
interface CacheSlot {
  key: string;
  url: string;
}

/** A storage read that rejects is a miss with a warning, so an outage costs one fetch. */
async function readCached<T>(storage: Storage, slot: CacheSlot): Promise<T | null> {
  const { key, url } = slot;
  try {
    return await storage.getItem<T>(key);
  } catch (error) {
    console.warn(`[forges] Could not read the cache for ${url}: ${String(error)}`);
    return null;
  }
}

/** A storage write that rejects is dropped with a warning; the response is already in hand. */
async function writeCached(storage: Storage, entry: CacheSlot & { value: unknown }): Promise<void> {
  const { key, url, value } = entry;
  try {
    await storage.setItem(key, value as Record<string, unknown>);
  } catch (error) {
    console.warn(`[forges] Could not cache ${url}: ${String(error)}`);
  }
}

/**
 * Clear all cache entries
 */
export async function clearCache(): Promise<void> {
  const storage = getStorage();
  const keys = await storage.getKeys();
  for (const key of keys) {
    await storage.removeItem(key);
  }
}

/**
 * Remove specific cache entry
 * @param client Client whose cached response should be dropped
 * @param request Request URL with the options it was cached under
 */
export async function invalidateCache(client: HttpClient, request: CachedRequest): Promise<void> {
  const { url, options } = splitRequest(request, "invalidateCache");
  const storage = getStorage();
  const cacheKey = generateCacheKey(clientCacheScope(client), { url, options });
  await storage.removeItem(cacheKey);
}

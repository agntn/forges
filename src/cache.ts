/**
 * Cache layer using unstorage with lru-cache driver
 * Provides caching for HTTP requests with TTL support
 */

import { createStorage, type Storage } from "unstorage";
import lruCacheDriver from "unstorage/drivers/lru-cache";
import type { $Fetch } from "ofetch";

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
 * @param url Request URL
 * @param options Request options
 * @returns Cache key
 */
function generateCacheKey(url: string, options?: CachedFetchOptions): string {
  let key = `cache:${url}`;

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
 * Wrapper around HTTP client that caches GET requests
 * @param client ofetch instance
 * @param url Request URL
 * @param options Request options
 * @returns Cached or fresh response
 */
export async function cachedFetch<T>(
  client: $Fetch,
  url: string,
  options?: CachedFetchOptions,
): Promise<T> {
  const method = (options?.method || "GET").toUpperCase();

  // Only cache GET requests
  if (method !== "GET") {
    return client<T>(url, options);
  }

  const storage = getStorage();
  const cacheKey = generateCacheKey(url, options);

  // Check cache first
  const cached = await storage.getItem<T>(cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached;
  }

  // Cache miss: fetch from client
  const result = options ? await client<T>(url, options) : await client<T>(url);

  // Store in cache
  await storage.setItem(cacheKey, result as Record<string, unknown>);

  return result;
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
 * @param url Request URL
 * @param options Request options
 */
export async function invalidateCache(url: string, options?: CachedFetchOptions): Promise<void> {
  const storage = getStorage();
  const cacheKey = generateCacheKey(url, options);
  await storage.removeItem(cacheKey);
}

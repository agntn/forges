/**
 * HTTP client factory with ofetch
 * Provides configurable authentication, retry logic, and rate limit awareness
 */

import { $fetch, FetchError, type $Fetch } from "ofetch";
import pkg from "../package.json" with { type: "json" };

/**
 * Configuration for HTTP client
 */
export interface HttpClientConfig {
  baseURL: string;
  token: string;
  tokenHeader?: string; // e.g., 'Authorization', 'Private-Token'
  tokenPrefix?: string; // e.g., 'token ', 'Bearer '
  userAgent?: string;
}

/**
 * Configured ofetch client used by provider implementations.
 */
export type HttpClient = $Fetch;

/**
 * Response data and metadata returned by {@link rawFetch}.
 */
export interface RawFetchResult<T> {
  data: T | undefined;
  headers: Headers;
  status: number;
}

/**
 * Create a configured ofetch instance with auth interceptors and retry logic
 */
export function createHttpClient(config: HttpClientConfig): HttpClient {
  const {
    baseURL,
    token,
    tokenHeader = "Authorization",
    tokenPrefix = "token ",
    userAgent = `forges/${pkg.version}`,
  } = config;

  return $fetch.create({
    baseURL,
    retry: 2,
    retryDelay: 1000,
    headers: {
      "User-Agent": userAgent,
    },
    onRequest({ request }) {
      // Skip auth header for unauthenticated requests (empty token is intentional)
      if (token) {
        const authValue = tokenPrefix ? `${tokenPrefix}${token}` : token;
        request.headers.set(tokenHeader, authValue);
      }
    },
    onResponseError({ response }) {
      // Warn on low rate limit
      const remaining = response.headers.get("X-RateLimit-Remaining");
      if (remaining !== null) {
        const remainingCount = parseInt(remaining, 10);
        if (remainingCount < 10) {
          console.warn(`[forges] Rate limit warning: ${remainingCount} requests remaining`);
        }
      }
    },
  });
}

/**
 * Wrapper around ofetch.raw() for accessing response headers
 * Useful for pagination and other header-based operations
 */
export async function rawFetch<T = unknown>(
  client: HttpClient,
  url: string,
  options?: Record<string, unknown>,
): Promise<RawFetchResult<T>> {
  const response = await client.raw<T>(url, options);
  return {
    data: response._data,
    headers: response.headers,
    status: response.status,
  };
}

// Re-export FetchError for convenience
export { FetchError };

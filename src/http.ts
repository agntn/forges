/**
 * HTTP client factory with ofetch
 * Provides configurable authentication, retry logic, and rate limit awareness
 */

import { $fetch, FetchError } from "ofetch";

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
 * Create a configured ofetch instance with auth interceptors and retry logic
 */
export function createHttpClient(config: HttpClientConfig) {
  const {
    baseURL,
    token,
    tokenHeader = "Authorization",
    tokenPrefix = "token ",
    userAgent = "gixa/0.1.0",
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
          console.warn(`[gixa] Rate limit warning: ${remainingCount} requests remaining`);
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
  client: ReturnType<typeof createHttpClient>,
  url: string,
  options?: Record<string, unknown>,
): Promise<{ data: T | undefined; headers: Headers; status: number }> {
  const response = await client.raw<T>(url, options);
  return {
    data: response._data,
    headers: response.headers,
    status: response.status,
  };
}

// Re-export FetchError for convenience
export { FetchError };

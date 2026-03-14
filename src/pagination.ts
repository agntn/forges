/**
 * Pagination helpers for GitHub, Gitea, and GitLab APIs
 * Supports Link header parsing and async pagination
 */

import { normalizeError } from "./errors.js";

/**
 * Parsed Link header entry
 */
export interface LinkHeaderEntry {
  url: string;
  rel: string;
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  perPage?: number;
  perPageParam?: string;
  maxPages?: number;
}

function resolveMaxPages(maxPages: number | undefined): number {
  if (maxPages === undefined) {
    return Infinity;
  }

  if (maxPages === Infinity) {
    return Infinity;
  }

  if (!Number.isFinite(maxPages) || maxPages < 1) {
    throwPaginationError("maxPages must be a finite number greater than or equal to 1");
  }

  return Math.floor(maxPages);
}

function throwPaginationError(message: string): never {
  throw normalizeError(new Error(message), "pagination");
}

function canonicalizePaginationUrl(input: string, baseURL: string): string {
  const url = new URL(input, baseURL);
  const sortedParams = new URLSearchParams(
    Array.from(url.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }
      return leftKey.localeCompare(rightKey);
    }),
  );

  url.search = sortedParams.toString();
  return url.toString();
}

function redactPaginationUrl(input: string, baseURL: string): string {
  const url = new URL(input, baseURL);
  return `${url.origin}${url.pathname}`;
}

/**
 * Parse GitHub-style Link header
 * Format: <https://api.github.com/repos?page=2>; rel="next", <https://api.github.com/repos?page=5>; rel="last"
 */
export function parseLinkHeader(header: string | null | undefined): Record<string, string> {
  const links: Record<string, string> = {};

  if (!header) {
    return links;
  }

  // Split by comma to get individual link entries
  const entries = header.split(",");

  for (const entry of entries) {
    // Match <url>; rel="relation"
    const match = entry.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      const [, url, rel] = match;
      links[rel] = url;
    }
  }

  return links;
}

/**
 * Async generator for paginating through results
 * Supports GitHub Link headers and GitLab x-next-page header
 */
export async function* paginate<T>(
  fetcher: (url: string) => Promise<{ data: T[]; headers: Headers }>,
  url: string,
  options: PaginationOptions = {},
): AsyncGenerator<T[], void, unknown> {
  const { perPage = 30, perPageParam = "per_page" } = options;
  const normalizedPerPageParam = perPageParam.trim();
  if (!normalizedPerPageParam) {
    throwPaginationError("perPageParam must be a non-empty query parameter name");
  }
  const maxPages = resolveMaxPages(options.maxPages);
  let baseURL: string;
  try {
    baseURL = new URL(url).origin;
  } catch {
    throwPaginationError("Invalid pagination URL");
  }

  let currentUrl = url;
  let pageCount = 0;
  const visitedUrls = new Set<string>();

  while (pageCount < maxPages) {
    // Add per-page parameter if not already present
    const urlObj = new URL(currentUrl, baseURL);
    if (!urlObj.searchParams.has(normalizedPerPageParam)) {
      urlObj.searchParams.set(normalizedPerPageParam, String(perPage));
    }
    const requestUrl = urlObj.toString();
    const canonicalCurrentUrl = canonicalizePaginationUrl(requestUrl, baseURL);

    if (visitedUrls.has(canonicalCurrentUrl)) {
      throwPaginationError(
        `Pagination loop detected: URL already visited: ${redactPaginationUrl(canonicalCurrentUrl, baseURL)}`,
      );
    }
    visitedUrls.add(canonicalCurrentUrl);

    // Fetch current page
    const response = await fetcher(requestUrl);
    const { data, headers } = response;

    // Yield current page
    yield data;
    pageCount++;

    // Check for next page via Link header (GitHub/Gitea)
    const linkHeader = headers.get("Link");
    const links = parseLinkHeader(linkHeader);

    let nextUrl: string | null = null;
    let canonicalNextUrl: string | null = null;
    if (links.next) {
      const linkNextUrl = new URL(links.next, baseURL);
      if (linkNextUrl.origin !== baseURL) {
        throwPaginationError(
          `Cross-origin pagination URL rejected: ${redactPaginationUrl(linkNextUrl.toString(), baseURL)}`,
        );
      }
      nextUrl = linkNextUrl.toString();
      canonicalNextUrl = canonicalizePaginationUrl(nextUrl, baseURL);
    } else {
      // Check for GitLab x-next-page header
      const nextPage = headers.get("x-next-page");
      if (nextPage) {
        const nextUrlObj = new URL(requestUrl, baseURL);
        nextUrlObj.searchParams.set("page", nextPage);
        nextUrl = nextUrlObj.toString();
        canonicalNextUrl = canonicalizePaginationUrl(nextUrl, baseURL);
      } else {
        // No more pages
        break;
      }
    }

    if (canonicalNextUrl === canonicalCurrentUrl) {
      throwPaginationError(
        `Pagination loop detected: next page equals current page: ${redactPaginationUrl(canonicalCurrentUrl, baseURL)}`,
      );
    }

    currentUrl = nextUrl;
  }
}

/**
 * Convenience wrapper to fetch all pages at once
 */
export async function fetchAllPages<T>(
  fetcher: (url: string) => Promise<{ data: T[]; headers: Headers }>,
  url: string,
  options: PaginationOptions = {},
): Promise<T[]> {
  const results: T[] = [];

  for await (const page of paginate(fetcher, url, options)) {
    results.push(...page);
  }

  return results;
}

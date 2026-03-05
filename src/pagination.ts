/**
 * Pagination helpers for GitHub, Gitea, and GitLab APIs
 * Supports Link header parsing and async pagination
 */

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
  maxPages?: number;
}

/**
 * Parse GitHub/Gitea-style Link header
 * Format: <https://api.github.com/repos?page=2>; rel="next", <https://api.github.com/repos?page=5>; rel="last"
 */
export function parseLinkHeader(header: string | null | undefined): Record<string, string> {
  const links: Record<string, string> = {};

  if (!header) {
    return links;
  }

  // Split by comma to get individual link entries
  const entries = header.split(',');

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
 * Supports GitHub/Gitea Link headers and GitLab x-next-page header
 */
export async function* paginate<T>(
  fetcher: (url: string, options?: any) => Promise<{ data: T[]; headers: Headers }>,
  url: string,
  options: PaginationOptions = {}
): AsyncGenerator<T[], void, unknown> {
  const { perPage = 30, maxPages = Infinity } = options;
  const baseURL = (() => {
    try {
      return new URL(url).origin;
    } catch {
      return 'https://example.invalid';
    }
  })();

  let currentUrl = url;
  let pageCount = 0;

  while (pageCount < maxPages) {
    // Add per_page parameter if not already present
    const urlObj = new URL(currentUrl, baseURL);
    if (!urlObj.searchParams.has('per_page')) {
      urlObj.searchParams.set('per_page', String(perPage));
    }
    currentUrl = urlObj.toString();

    // Fetch current page
    const response = await fetcher(currentUrl);
    const { data, headers } = response;

    // Yield current page
    yield data;
    pageCount++;

    // Check for next page via Link header (GitHub/Gitea)
    const linkHeader = headers.get('Link');
    const links = parseLinkHeader(linkHeader);

    if (links.next) {
      currentUrl = links.next;
    } else {
      // Check for GitLab x-next-page header
      const nextPage = headers.get('x-next-page');
      if (nextPage) {
        const urlObj = new URL(currentUrl, baseURL);
        urlObj.searchParams.set('page', nextPage);
        currentUrl = urlObj.toString();
      } else {
        // No more pages
        break;
      }
    }
  }
}

/**
 * Convenience wrapper to fetch all pages at once
 */
export async function fetchAllPages<T>(
  fetcher: (url: string, options?: any) => Promise<{ data: T[]; headers: Headers }>,
  url: string,
  options: PaginationOptions = {}
): Promise<T[]> {
  const results: T[] = [];

  for await (const page of paginate(fetcher, url, options)) {
    results.push(...page);
  }

  return results;
}

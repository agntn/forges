import { describe, it, expect } from "vitest";
import { parseLinkHeader, paginate, fetchAllPages } from "../src/pagination";

describe("parseLinkHeader", () => {
  it("returns empty object for null or undefined", () => {
    expect(parseLinkHeader(null)).toEqual({});
    expect(parseLinkHeader(undefined)).toEqual({});
    expect(parseLinkHeader("")).toEqual({});
  });

  it("parses a single link entry", () => {
    const header = '<https://api.github.com/repos?page=2>; rel="next"';
    const result = parseLinkHeader(header);

    expect(result).toEqual({ next: "https://api.github.com/repos?page=2" });
  });

  it("parses multiple link entries", () => {
    const header =
      '<https://api.github.com/repos?page=2>; rel="next", ' +
      '<https://api.github.com/repos?page=5>; rel="last", ' +
      '<https://api.github.com/repos?page=1>; rel="first"';
    const result = parseLinkHeader(header);

    expect(result).toEqual({
      next: "https://api.github.com/repos?page=2",
      last: "https://api.github.com/repos?page=5",
      first: "https://api.github.com/repos?page=1",
    });
  });
});

describe("paginate", () => {
  it("yields pages following Link header next URLs", async () => {
    const fetcher = async (url: string) => {
      const u = new URL(url);
      const page = u.searchParams.get("page") || "1";

      if (page === "1") {
        return {
          data: [{ id: 1 }, { id: 2 }],
          headers: new Headers({
            Link: '<https://api.github.com/repos?page=2&per_page=2>; rel="next"',
          }),
        };
      }
      return {
        data: [{ id: 3 }],
        headers: new Headers({}),
      };
    };

    const pages: any[][] = [];
    for await (const page of paginate(fetcher, "https://api.github.com/repos", { perPage: 2 })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual([{ id: 1 }, { id: 2 }]);
    expect(pages[1]).toEqual([{ id: 3 }]);
  });

  it("respects maxPages limit", async () => {
    const fetcher = async (_url: string) => ({
      data: [{ id: 1 }],
      headers: new Headers({
        Link: '<https://api.github.com/repos?page=999>; rel="next"',
      }),
    });

    const pages: any[][] = [];
    for await (const page of paginate(fetcher, "https://api.github.com/repos", { maxPages: 2 })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
  });

  it("stops when no next page indicator exists", async () => {
    const fetcher = async (_url: string) => ({
      data: [{ id: 1 }],
      headers: new Headers({}),
    });

    const pages: any[][] = [];
    for await (const page of paginate(fetcher, "https://api.github.com/repos")) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
  });

  it("follows GitLab x-next-page while preserving original host", async () => {
    const seenUrls: string[] = [];
    const fetcher = async (url: string) => {
      seenUrls.push(url);
      const u = new URL(url);
      const page = u.searchParams.get("page") || "1";

      if (page === "1") {
        return {
          data: [{ id: 1 }],
          headers: new Headers({ "x-next-page": "2" }),
        };
      }

      return {
        data: [{ id: 2 }],
        headers: new Headers({}),
      };
    };

    const pages: Array<Array<{ id: number }>> = [];
    for await (const page of paginate(
      fetcher,
      "https://gitlab.selfhosted.example/api/v4/projects",
    )) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
    expect(seenUrls[1]).toContain("gitlab.selfhosted.example");
    expect(seenUrls[1]).toContain("page=2");
  });

  it('throws when Link pagination repeats the same URL', async () => {
    const fetcher = async (_url: string) => ({
      data: [{ id: 1 }],
      headers: new Headers({
        Link: '<https://api.github.com/repos?page=1>; rel="next"',
      }),
    });

    await expect(async () => {
      for await (const _page of paginate(fetcher, 'https://api.github.com/repos', { maxPages: 5 })) {
      }
    }).rejects.toThrow('Pagination loop detected');
  });

  it('accepts same-origin relative Link header pagination URLs', async () => {
    const seenUrls: string[] = [];
    const fetcher = async (url: string) => {
      seenUrls.push(url);
      const page = new URL(url).searchParams.get('page') || '1';

      if (page === '1') {
        return {
          data: [{ id: 1 }],
          headers: new Headers({
            Link: '</repos?page=2>; rel="next"',
          }),
        };
      }

      return {
        data: [{ id: 2 }],
        headers: new Headers({}),
      };
    };

    const pages: Array<Array<{ id: number }>> = [];
    for await (const page of paginate(fetcher, 'https://api.github.com/repos', { maxPages: 5 })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
    expect(seenUrls[1]).toContain('https://api.github.com/repos?page=2');
  });

  it('detects loops when Link next URL only reorders query params', async () => {
    let callCount = 0;
    const fetcher = async (_url: string) => {
      callCount++;
      return {
        data: [{ id: callCount }],
        headers: new Headers({
          Link: '<https://api.github.com/repos?b=2&page=1&a=1>; rel="next"',
        }),
      };
    };

    await expect(async () => {
      for await (const _page of paginate(fetcher, 'https://api.github.com/repos?a=1&page=1&b=2', { maxPages: 5 })) {
      }
    }).rejects.toThrow('Pagination loop detected');
  });

  it('throws when GitLab x-next-page repeats the current page', async () => {
    const fetcher = async (_url: string) => ({
      data: [{ id: 1 }],
      headers: new Headers({ 'x-next-page': '1' }),
    });

    await expect(async () => {
      for await (const _page of paginate(fetcher, 'https://gitlab.example.com/api/v4/projects', { maxPages: 5 })) {
      }
    }).rejects.toThrow('Pagination loop detected');
  });

  it('throws for maxPages below 1', async () => {
    const fetcher = async (_url: string) => ({
      data: [{ id: 1 }],
      headers: new Headers({}),
    });

    await expect(async () => {
      for await (const _page of paginate(fetcher, 'https://api.github.com/repos', { maxPages: 0 })) {
      }
    }).rejects.toThrow('maxPages must be a finite number greater than or equal to 1');
  });

  it('throws for maxPages NaN', async () => {
    const fetcher = async (_url: string) => ({
      data: [{ id: 1 }],
      headers: new Headers({}),
    });

    await expect(async () => {
      for await (const _page of paginate(fetcher, 'https://api.github.com/repos', { maxPages: Number.NaN })) {
      }
    }).rejects.toThrow('maxPages must be a finite number greater than or equal to 1');
  });

  it('throws for negative maxPages', async () => {
    const fetcher = async (_url: string) => ({
      data: [{ id: 1 }],
      headers: new Headers({}),
    });

    await expect(async () => {
      for await (const _page of paginate(fetcher, 'https://api.github.com/repos', { maxPages: -1 })) {
      }
    }).rejects.toThrow('maxPages must be a finite number greater than or equal to 1');
  });

  it('throws for negative infinity maxPages', async () => {
    const fetcher = async (_url: string) => ({
      data: [{ id: 1 }],
      headers: new Headers({}),
    });

    await expect(async () => {
      for await (const _page of paginate(fetcher, 'https://api.github.com/repos', { maxPages: Number.NEGATIVE_INFINITY })) {
      }
    }).rejects.toThrow('maxPages must be a finite number greater than or equal to 1');
  });

  it('throws for fractional maxPages below 1', async () => {
    const fetcher = async (_url: string) => ({
      data: [{ id: 1 }],
      headers: new Headers({}),
    });

    await expect(async () => {
      for await (const _page of paginate(fetcher, 'https://api.github.com/repos', { maxPages: 0.5 })) {
      }
    }).rejects.toThrow('maxPages must be a finite number greater than or equal to 1');
  });

  it('accepts and floors fractional maxPages above 1', async () => {
    const fetcher = async (_url: string) => ({
      data: [{ id: 1 }],
      headers: new Headers({
        Link: '<https://api.github.com/repos?page=2>; rel="next"',
      }),
    });

    const pages: Array<Array<{ id: number }>> = [];
    for await (const page of paginate(fetcher, 'https://api.github.com/repos', { maxPages: 1.5 })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual([{ id: 1 }]);
  });

  it('accepts explicit Infinity maxPages', async () => {
    const fetcher = async (url: string) => {
      const page = new URL(url).searchParams.get('page') || '1';

      if (page === '1') {
        return {
          data: [{ id: 1 }],
          headers: new Headers({
            Link: '<https://api.github.com/repos?page=2>; rel="next"',
          }),
        };
      }

      return {
        data: [{ id: 2 }],
        headers: new Headers({}),
      };
    };

    const pages: Array<Array<{ id: number }>> = [];
    for await (const page of paginate(fetcher, 'https://api.github.com/repos', { maxPages: Infinity })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
  });

  it('throws for invalid initial pagination URL', async () => {
    const fetcher = async (_url: string) => ({
      data: [{ id: 1 }],
      headers: new Headers({}),
    });

    await expect(async () => {
      for await (const _page of paginate(fetcher, '://invalid-url')) {
      }
    }).rejects.toThrow('Invalid pagination URL');
  });

  it('rejects cross-origin Link header pagination URLs', async () => {
    const fetcher = async (_url: string) => ({
      data: [{ id: 1 }],
      headers: new Headers({
        Link: '<https://example.evil.invalid/repos?page=2>; rel="next"',
      }),
    });

    await expect(async () => {
      for await (const _page of paginate(fetcher, 'https://api.github.com/repos', { maxPages: 5 })) {
      }
    }).rejects.toThrow('Cross-origin pagination URL rejected');
  });
});

describe("fetchAllPages", () => {
  it("collects all pages into a flat array", async () => {
    let callCount = 0;
    const fetcher = async (_url: string) => {
      callCount++;
      if (callCount === 1) {
        return {
          data: [{ id: 1 }, { id: 2 }],
          headers: new Headers({
            Link: '<https://api.github.com/repos?page=2&per_page=30>; rel="next"',
          }),
        };
      }
      return {
        data: [{ id: 3 }],
        headers: new Headers({}),
      };
    };

    const result = await fetchAllPages(fetcher, "https://api.github.com/repos");

    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('propagates pagination loop guard errors', async () => {
    const fetcher = async (_url: string) => ({
      data: [{ id: 1 }],
      headers: new Headers({
        Link: '<https://api.github.com/repos?page=1>; rel="next"',
      }),
    });

    await expect(fetchAllPages(fetcher, 'https://api.github.com/repos', { maxPages: 5 })).rejects.toThrow(
      'Pagination loop detected',
    );
  });
});

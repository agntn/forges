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
});

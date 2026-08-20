import { createRequire } from "node:module";
import { describe, it, expect, vi, beforeEach } from "vitest";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const mockCreateConfigs: any[] = [];
const mockRaw = vi.fn();

vi.mock("ofetch", () => ({
  $fetch: {
    create: (config: any) => {
      mockCreateConfigs.push(config);
      const fn = vi.fn() as any;
      fn.raw = mockRaw;
      return fn;
    },
  },
  FetchError: class FetchError extends Error {},
}));

import { createHttpClient, rawFetch } from "../src/http.ts";
import { CACHE_SCOPE } from "../src/cache.ts";

describe("cache scope tagging", () => {
  const scopeOf = (client: unknown) => (client as Record<symbol, string>)[CACHE_SCOPE];

  it("separates clients by base URL", () => {
    const saas = createHttpClient({ baseURL: "https://gitlab.com/api/v4", token: "t" });
    const selfHosted = createHttpClient({ baseURL: "https://git.example.com/api/v4", token: "t" });

    expect(scopeOf(saas)).not.toBe(scopeOf(selfHosted));
  });

  it("separates clients by token on the same host", () => {
    const alice = createHttpClient({ baseURL: "https://gitlab.com/api/v4", token: "alice" });
    const bob = createHttpClient({ baseURL: "https://gitlab.com/api/v4", token: "bob" });

    expect(scopeOf(alice)).not.toBe(scopeOf(bob));
  });

  it("never puts the raw token in the scope", () => {
    const client = createHttpClient({
      baseURL: "https://gitlab.com/api/v4",
      token: "glpat-super-secret",
    });

    expect(scopeOf(client)).not.toContain("glpat-super-secret");
    expect(scopeOf(client)).toContain("https://gitlab.com/api/v4");
  });

  it("reuses one scope for the same host and token", () => {
    const first = createHttpClient({ baseURL: "https://gitlab.com/api/v4", token: "t" });
    const second = createHttpClient({ baseURL: "https://gitlab.com/api/v4", token: "t" });

    expect(scopeOf(first)).toBe(scopeOf(second));
  });
});

describe("createHttpClient", () => {
  beforeEach(() => {
    mockCreateConfigs.length = 0;
    mockRaw.mockReset();
  });

  it("passes baseURL, retry, and default User-Agent to $fetch.create", () => {
    createHttpClient({
      baseURL: "https://api.github.com",
      token: "test-token",
    });

    const config = mockCreateConfigs[0];
    expect(config.baseURL).toBe("https://api.github.com");
    expect(config.retry).toBe(2);
    expect(config.retryDelay).toBe(1000);
    expect(config.headers["User-Agent"]).toBe(`forges/${version}`);
  });

  it("uses custom userAgent when provided", () => {
    createHttpClient({
      baseURL: "https://api.github.com",
      token: "test",
      userAgent: "my-app/2.0",
    });

    expect(mockCreateConfigs[0].headers["User-Agent"]).toBe("my-app/2.0");
  });

  it('sets Authorization header with default "token " prefix', () => {
    createHttpClient({
      baseURL: "https://api.github.com",
      token: "ghp_abc123",
    });

    const headers = new Headers();
    mockCreateConfigs[0].onRequest({
      request: "https://api.github.com/repos/agntn/forges",
      options: { headers },
    });

    expect(headers.get("Authorization")).toBe("token ghp_abc123");
  });

  it("supports custom tokenHeader and empty tokenPrefix (GitLab style)", () => {
    createHttpClient({
      baseURL: "https://gitlab.com/api/v4",
      token: "glpat-xyz",
      tokenHeader: "Private-Token",
      tokenPrefix: "",
    });

    const headers = new Headers();
    mockCreateConfigs[0].onRequest({
      request: "https://gitlab.com/api/v4/projects/agntn%2Fforges",
      options: { headers },
    });

    expect(headers.get("Private-Token")).toBe("glpat-xyz");
  });

  it("warns when X-RateLimit-Remaining < 10", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createHttpClient({ baseURL: "https://api.github.com", token: "test" });

    mockCreateConfigs[0].onResponseError({
      response: {
        headers: {
          get: (key: string) => (key === "X-RateLimit-Remaining" ? "5" : null),
        },
      },
    });

    expect(warn).toHaveBeenCalledWith("[forges] Rate limit warning: 5 requests remaining");
    warn.mockRestore();
  });

  it("does not warn when X-RateLimit-Remaining >= 10", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createHttpClient({ baseURL: "https://api.github.com", token: "test" });

    mockCreateConfigs[0].onResponseError({
      response: {
        headers: {
          get: (key: string) => (key === "X-RateLimit-Remaining" ? "50" : null),
        },
      },
    });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not warn when X-RateLimit-Remaining header is absent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createHttpClient({ baseURL: "https://api.github.com", token: "test" });

    mockCreateConfigs[0].onResponseError({
      response: { headers: { get: () => null } },
    });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips auth header when token is empty", () => {
    createHttpClient({
      baseURL: "https://api.github.com",
      token: "",
    });

    const headers = new Headers();
    mockCreateConfigs[0].onRequest({
      request: "https://api.github.com/repos/agntn/forges",
      options: { headers },
    });

    expect(headers.has("Authorization")).toBe(false);
  });
});

describe("rawFetch", () => {
  beforeEach(() => {
    mockCreateConfigs.length = 0;
    mockRaw.mockReset();
  });

  it("returns { data, headers, status } from client.raw()", async () => {
    const responseHeaders = new Headers({ "content-type": "application/json" });
    mockRaw.mockResolvedValueOnce({
      _data: [{ id: 1, name: "forges" }],
      headers: responseHeaders,
      status: 200,
    });

    const client = createHttpClient({ baseURL: "https://api.github.com", token: "test" });
    const result = await rawFetch(client, "/repos/unjs/ugp");

    expect(mockRaw).toHaveBeenCalledWith("/repos/unjs/ugp", undefined);
    expect(result.data).toEqual([{ id: 1, name: "forges" }]);
    expect(result.status).toBe(200);
    expect(result.headers).toBe(responseHeaders);
  });
});

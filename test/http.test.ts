import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";

import { createHttpClient, rawFetch } from "../src/http.ts";
import { CACHE_SCOPE } from "../src/cache.ts";
import { FetchError, normalizeError } from "../src/errors.ts";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...init.headers },
  });
}

function sent(call = 0): { url: string; init: RequestInit; headers: Headers } {
  const [url, init = {}] = fetchMock.mock.calls[call] ?? [];
  return { url: String(url), init, headers: new Headers(init.headers) };
}

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

  it.each(["", "glpat-ascii", "token-zażółć-🔑", "x\udfffy"])(
    "keys the scope by the first 16 hex of the token's SHA-256 (%j)",
    (token) => {
      const client = createHttpClient({ baseURL: "https://gitlab.com/api/v4", token });
      const digest = createHash("sha256").update(token).digest("hex").slice(0, 16);

      expect(scopeOf(client)).toBe(`https://gitlab.com/api/v4#${digest}`);
    },
  );

  it("reuses one scope for the same host and token", () => {
    const first = createHttpClient({ baseURL: "https://gitlab.com/api/v4", token: "t" });
    const second = createHttpClient({ baseURL: "https://gitlab.com/api/v4", token: "t" });

    expect(scopeOf(first)).toBe(scopeOf(second));
  });
});

describe("createHttpClient", () => {
  it("joins the path to the base URL and sends the default User-Agent", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    const client = createHttpClient({ baseURL: "https://api.github.com/", token: "t" });

    expect(await client("/repos/agntn/forges")).toEqual({ ok: true });
    expect(sent().url).toBe("https://api.github.com/repos/agntn/forges");
    expect(sent().init.method).toBe("GET");
    expect(sent().headers.get("User-Agent")).toBe(`forges/${version}`);
  });

  it("leaves a URL that already starts with the base URL alone", async () => {
    fetchMock.mockResolvedValueOnce(json([]));
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });

    await client("https://api.github.com/user/repos?page=2");

    expect(sent().url).toBe("https://api.github.com/user/repos?page=2");
  });

  it("uses custom userAgent when provided", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    const client = createHttpClient({
      baseURL: "https://api.github.com",
      token: "test",
      userAgent: "my-app/2.0",
    });

    await client("/user");

    expect(sent().headers.get("User-Agent")).toBe("my-app/2.0");
  });

  it('sets Authorization header with default "token " prefix', async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "ghp_abc123" });

    await client("/repos/agntn/forges");

    expect(sent().headers.get("Authorization")).toBe("token ghp_abc123");
  });

  it("supports custom tokenHeader and empty tokenPrefix (GitLab style)", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    const client = createHttpClient({
      baseURL: "https://gitlab.com/api/v4",
      token: "glpat-xyz",
      tokenHeader: "Private-Token",
      tokenPrefix: "",
    });

    await client("/projects/agntn%2Fforges");

    expect(sent().headers.get("Private-Token")).toBe("glpat-xyz");
    expect(sent().headers.has("Authorization")).toBe(false);
  });

  it("skips auth header when token is empty", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "" });

    await client("/repos/agntn/forges");

    expect(sent().headers.has("Authorization")).toBe(false);
  });

  it("keeps the token over a header the request names itself", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "real" });

    await client("/user", { headers: { Authorization: "token forged", Accept: "text/plain" } });

    expect(sent().headers.get("Authorization")).toBe("token real");
    expect(sent().headers.get("Accept")).toBe("text/plain");
  });

  it("appends the query, skipping undefined values and repeating arrays", async () => {
    fetchMock.mockResolvedValueOnce(json([]));
    const client = createHttpClient({ baseURL: "https://gitlab.com/api/v4", token: "t" });

    await client("/projects?simple=true", {
      query: { page: 2, simple: false, search: "a b&c", labels: ["x", "y"], skip: undefined },
    });

    const url = new URL(sent().url);
    expect(url.pathname).toBe("/api/v4/projects");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.getAll("simple")).toEqual(["false"]);
    expect(url.searchParams.get("search")).toBe("a b&c");
    expect(url.searchParams.getAll("labels")).toEqual(["x", "y"]);
    expect(url.searchParams.has("skip")).toBe(false);
  });

  it("sends an object body as JSON on a write", async () => {
    fetchMock.mockResolvedValueOnce(json({ number: 1 }, { status: 201 }));
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });

    const created = await client("/repos/o/r/issues", { method: "post", body: { title: "Bug" } });

    expect(created).toEqual({ number: 1 });
    expect(sent().init.method).toBe("POST");
    expect(sent().init.body).toBe('{"title":"Bug"}');
    expect(sent().headers.get("content-type")).toBe("application/json");
    expect(sent().headers.get("accept")).toBe("application/json");
  });

  it("passes a FormData body through untouched", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });
    const form = new FormData();

    await client("/upload", { method: "POST", body: form });

    expect(sent().init.body).toBe(form);
    expect(sent().headers.has("content-type")).toBe(false);
  });

  it("reads the body by content type unless the request names one", async () => {
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });

    fetchMock.mockResolvedValueOnce(
      new Response("plain", { headers: { "content-type": "text/plain" } }),
    );
    expect(await client("/a")).toBe("plain");

    fetchMock.mockResolvedValueOnce(new Response("not json"));
    expect(await client("/b")).toBe("not json");

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await client("/c", { method: "DELETE" })).toBeUndefined();

    fetchMock.mockResolvedValueOnce(json({ sha: "abc" }));
    expect(await client<string, "text">("/d", { responseType: "text" })).toBe('{"sha":"abc"}');
  });

  it("hands back the body stream for a stream response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("line 1\nline 2"));
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });

    const stream = await client<unknown, "stream">("/logs", { responseType: "stream" });

    expect(stream).toBeInstanceOf(ReadableStream);
    expect(await new Response(stream).text()).toBe("line 1\nline 2");
  });

  it("throws a FetchError with the status, the parsed body and the request line", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ message: "Not Found" }, { status: 404, statusText: "Not Found" }),
    );
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });

    const error = await client("/repos/o/missing", { query: { ref: "main" } }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(FetchError);
    const failure = error as FetchError;
    expect(failure.message).toBe(
      '[GET] "https://api.github.com/repos/o/missing?ref=main": 404 Not Found',
    );
    expect(failure.status).toBe(404);
    expect(failure.statusCode).toBe(404);
    expect(failure.statusText).toBe("Not Found");
    expect(failure.data).toEqual({ message: "Not Found" });
    expect(failure.response?.status).toBe(404);
    expect(normalizeError(failure, "github").status).toBe(404);
  });

  it("reports a request that got no response, with the cause", async () => {
    const cause = new TypeError("fetch failed");
    fetchMock.mockRejectedValue(cause);
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });

    const error = (await client("/user", { retry: 0 }).catch(
      (caught: unknown) => caught,
    )) as FetchError;

    expect(error).toBeInstanceOf(FetchError);
    expect(error.message).toBe('[GET] "https://api.github.com/user": <no response> fetch failed');
    expect(error.status).toBeUndefined();
    expect(error.cause).toBe(cause);
  });

  it("retries a read twice after a failure with no response", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });

    await expect(client("/user", { retryDelay: 0 })).rejects.toBeInstanceOf(FetchError);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a read whose body breaks off and keeps the status on the error", async () => {
    const cut = (): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new TypeError("terminated"));
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    fetchMock.mockImplementation(async () => cut());
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });

    await expect(client("/user", { retryDelay: 0 })).rejects.toMatchObject({
      name: "FetchError",
      status: 200,
      cause: expect.objectContaining({ message: "terminated" }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry an aborted request", async () => {
    fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });

    await expect(client("/user", { retryDelay: 0 })).rejects.toBeInstanceOf(FetchError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries only the statuses the request lists", async () => {
    fetchMock.mockImplementation(async () => json({}, { status: 408 }));
    const client = createHttpClient({ baseURL: "https://gitlab.com/api/v4", token: "t" });

    await expect(
      client("/merge_requests", { retryDelay: 0, retryStatusCodes: [429, 500] }),
    ).rejects.toMatchObject({ status: 408 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    await expect(client("/merge_requests", { retryDelay: 0 })).rejects.toMatchObject({
      status: 408,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns the answer of a retry that succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, { status: 502 }))
      .mockResolvedValueOnce(json({ login: "octocat" }));
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });

    expect(await client("/user", { retryDelay: 0 })).toEqual({ login: "octocat" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waits out a short Retry-After before the retry", async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(json({}, { status: 429, headers: { "Retry-After": "2" } }))
        .mockResolvedValueOnce(json({ login: "octocat" }));
      const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });

      const answer = client("/user", { retryDelay: 0 });
      await vi.advanceTimersByTimeAsync(1999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      expect(await answer).toEqual({ login: "octocat" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up at once when Retry-After asks for more than a retry is worth", async () => {
    fetchMock.mockImplementation(async () =>
      json({}, { status: 429, headers: { "Retry-After": "60" } }),
    );
    const client = createHttpClient({ baseURL: "https://gitlab.com/api/v4", token: "t" });

    const error = await client("/projects", { retryDelay: 0 }).catch((caught: unknown) => caught);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(normalizeError(error, "gitlab")).toMatchObject({ status: 429, retryAfter: 60 });
  });

  it("gives up at once on a spent rate limit that resets later", async () => {
    const reset = Math.ceil(Date.now() / 1000) + 3600;
    fetchMock.mockImplementation(async () =>
      json(
        {},
        {
          status: 429,
          headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(reset) },
        },
      ),
    );
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(client("/user", { retryDelay: 0 })).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a write unless the request asks", async () => {
    fetchMock.mockImplementation(async () => json({}, { status: 503 }));
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "t" });

    await expect(client("/repos/o/r/issues", { method: "POST", body: {} })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    await expect(
      client("/repos/o/r/issues", { method: "POST", body: {}, retry: 1, retryDelay: 0 }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("warns when X-RateLimit-Remaining < 10", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(
      json({}, { status: 403, headers: { "X-RateLimit-Remaining": "5" } }),
    );
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "test" });

    await expect(client("/user")).rejects.toThrow();

    expect(warn).toHaveBeenCalledWith("[forges] Rate limit warning: 5 requests remaining");
    warn.mockRestore();
  });

  it("does not warn when X-RateLimit-Remaining >= 10 or is absent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce(json({}, { status: 403, headers: { "X-RateLimit-Remaining": "50" } }))
      .mockResolvedValueOnce(json({}, { status: 403 }));
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "test" });

    await expect(client("/user")).rejects.toThrow();
    await expect(client("/user")).rejects.toThrow();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("rawFetch", () => {
  it("returns { data, headers, status } from the response", async () => {
    const link = '<https://api.github.com/user/repos?page=2>; rel="next"';
    fetchMock.mockResolvedValueOnce(json([{ id: 1, name: "forges" }], { headers: { link } }));
    const client = createHttpClient({ baseURL: "https://api.github.com", token: "test" });

    const result = await rawFetch(client, "/user/repos", { query: { per_page: 1 } });

    expect(sent().url).toBe("https://api.github.com/user/repos?per_page=1");
    expect(result.data).toEqual([{ id: 1, name: "forges" }]);
    expect(result.status).toBe(200);
    expect(result.headers.get("link")).toBe(link);
  });
});

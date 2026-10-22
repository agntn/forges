import { describe, expect, it, vi } from "vite-plus/test";

import { CACHE_SCOPE } from "../src/cache.ts";
import { FetchError, NotFoundError } from "../src/errors.ts";
import { createForgeClient, rawFetch, toFetchError } from "../src/http.ts";

/** A `forges` provider whose `request` is the mock a test drives. */
function fakeForge() {
  const request = vi.fn();
  return { forge: { request } as never, request };
}

function raw(body: BodyInit | null, init: ResponseInit = {}) {
  const response = new Response(body, init);
  return {
    status: response.status,
    headers: response.headers,
    body: response.body ?? new Blob([]).stream(),
  };
}

function json(value: unknown, init: ResponseInit = {}) {
  return raw(JSON.stringify(value), { ...init, headers: { "content-type": "application/json" } });
}

/** A failure shaped the way `forges` throws one. */
function forgeFailure(name: string, fields: Record<string, unknown>): Error {
  return Object.assign(new Error(`${name} from forges`), { name, ...fields });
}

describe("createForgeClient", () => {
  it("tags the client with its cache scope", () => {
    const { forge } = fakeForge();
    const client = createForgeClient(() => Promise.resolve(forge), { scope: "https://x#abc" });

    expect((client as unknown as Record<symbol, unknown>)[CACHE_SCOPE]).toBe("https://x#abc");
  });

  it("sends the method, path, query, headers and body through forges as a raw request", async () => {
    const { forge, request } = fakeForge();
    request.mockResolvedValueOnce(json({ ok: true }));
    const client = createForgeClient(() => Promise.resolve(forge), { scope: "s" });

    const data = await client("/repos/o/r/issues?sort=created", {
      method: "post",
      query: { state: "open", skipped: undefined, labels: ["a", "b"] },
      headers: { accept: "application/vnd.github+json" },
      body: { title: "t" },
    });

    expect(data).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith(
      "POST",
      "/repos/o/r/issues?sort=created&state=open&labels=a&labels=b",
      {
        raw: true,
        body: { title: "t" },
        headers: { accept: "application/vnd.github+json" },
        signal: undefined,
      },
    );
  });

  it("puts the prefix in front of a path, never in front of a whole URL", async () => {
    const { forge, request } = fakeForge();
    request.mockImplementation(async () => json([]));
    const client = createForgeClient(() => Promise.resolve(forge), {
      scope: "s",
      prefix: "/accounts/abc/artifacts/",
    });

    await client("/namespaces/default/repos");
    await client("https://api.cloudflare.com/client/v4/accounts/abc/artifacts/x?cursor=2");

    expect(request.mock.calls.map(([, path]) => path)).toEqual([
      "/accounts/abc/artifacts/namespaces/default/repos",
      "https://api.cloudflare.com/client/v4/accounts/abc/artifacts/x?cursor=2",
    ]);
  });

  it("reads the body by content type unless the request names one", async () => {
    const { forge, request } = fakeForge();
    request
      .mockResolvedValueOnce(raw("plain", { headers: { "content-type": "text/plain" } }))
      .mockResolvedValueOnce(raw('{"a":1}', { headers: { "content-type": "text/plain" } }))
      .mockResolvedValueOnce(
        raw(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } }),
      )
      .mockResolvedValueOnce(raw(null, { status: 204 }));
    const client = createForgeClient(() => Promise.resolve(forge), { scope: "s" });

    expect(await client("/a")).toBe("plain");
    expect(await client("/b", { responseType: "json" })).toEqual({ a: 1 });
    expect(await client("/c")).toBeInstanceOf(Blob);
    expect(await client("/d", { method: "DELETE" })).toBeUndefined();
  });

  it("hands back the body stream for a stream response", async () => {
    const { forge, request } = fakeForge();
    request.mockResolvedValueOnce(raw("log line", { headers: { "content-type": "text/plain" } }));
    const client = createForgeClient(() => Promise.resolve(forge), { scope: "s" });

    const stream = await client<unknown, "stream">("/logs", { responseType: "stream" });

    expect(await new Response(stream).text()).toBe("log line");
  });

  it("turns a forges failure into a FetchError with the status, the parsed body and the request line", async () => {
    const { forge, request } = fakeForge();
    request.mockRejectedValueOnce(
      forgeFailure("NotFoundError", {
        status: 404,
        body: '{"message":"Not Found"}',
        method: "GET",
        url: "https://api.github.com/repos/o/missing",
      }),
    );
    const client = createForgeClient(() => Promise.resolve(forge), { scope: "s" });

    const error = await client("/repos/o/missing").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FetchError);
    expect(error).toMatchObject({
      message: '[GET] "https://api.github.com/repos/o/missing": 404 Not Found',
      status: 404,
      statusText: "Not Found",
      data: { message: "Not Found" },
      request: "https://api.github.com/repos/o/missing",
    });
  });

  it("keeps the wait of a rate limit as the Retry-After it would have sent", async () => {
    const resetAt = new Date(Date.now() + 42_000);
    const error = toFetchError(
      forgeFailure("RateLimitedError", { status: 429, body: "", resetAt, method: "GET", url: "u" }),
    ) as FetchError;

    expect(Number(error.response?.headers.get("Retry-After"))).toBeGreaterThanOrEqual(41);
  });

  it("reports a request that got no response, with the cause", () => {
    const failure = forgeFailure("ForgeNetworkError", { method: "POST", url: "https://x/y" });

    const error = toFetchError(failure) as FetchError;

    expect(error).toBeInstanceOf(FetchError);
    expect(error.status).toBeUndefined();
    expect(error.cause).toBe(failure);
    expect(error.options).toMatchObject({ method: "POST" });
  });

  it("keeps an error this library already classified, status and platform included", () => {
    const failure = new NotFoundError("Repository not found", { platform: "github" });

    expect(toFetchError(failure)).toBe(failure);
  });

  it("leaves a failure that is not a request failure alone", () => {
    const failure = forgeFailure("UnsupportedOperationError", {});

    expect(toFetchError(failure)).toBe(failure);
  });

  it("retries a read twice on a status worth another try and returns the answer that came", async () => {
    const { forge, request } = fakeForge();
    const unavailable = forgeFailure("ForgeApiError", {
      status: 503,
      body: "",
      method: "GET",
      url: "u",
    });
    request
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce(json({ ok: true }));
    const client = createForgeClient(() => Promise.resolve(forge), { scope: "s" });

    await expect(client("/a", { retryDelay: 0 })).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("retries a read whose body breaks off, but never a write", async () => {
    const { forge, request } = fakeForge();
    const cut = () => ({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new TypeError("terminated"));
        },
      }),
    });
    request.mockResolvedValueOnce(cut()).mockResolvedValueOnce(json({ ok: true }));
    const client = createForgeClient(() => Promise.resolve(forge), { scope: "s" });

    await expect(client("/a", { retryDelay: 0 })).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(2);

    request.mockReset();
    request.mockResolvedValueOnce(cut());
    await expect(client("/b", { method: "POST", retryDelay: 0 })).rejects.toMatchObject({
      status: 200,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("never retries a write, a missing resource or an aborted read", async () => {
    const { forge, request } = fakeForge();
    request.mockRejectedValue(
      forgeFailure("ForgeApiError", { status: 503, body: "", method: "POST", url: "u" }),
    );
    const client = createForgeClient(() => Promise.resolve(forge), { scope: "s" });

    await expect(client("/a", { method: "POST", retryDelay: 0 })).rejects.toBeInstanceOf(
      FetchError,
    );
    expect(request).toHaveBeenCalledTimes(1);

    request.mockReset();
    request.mockRejectedValue(
      forgeFailure("NotFoundError", { status: 404, body: "", method: "GET", url: "u" }),
    );
    await expect(client("/b", { retryDelay: 0 })).rejects.toMatchObject({ status: 404 });
    expect(request).toHaveBeenCalledTimes(1);

    request.mockReset();
    request.mockRejectedValue(forgeFailure("ForgeNetworkError", { method: "GET", url: "u" }));
    const controller = new AbortController();
    controller.abort();
    await expect(client("/c", { signal: controller.signal, retryDelay: 0 })).rejects.toBeInstanceOf(
      FetchError,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("gives up at once when Retry-After asks for more than a retry is worth", async () => {
    const { forge, request } = fakeForge();
    request.mockRejectedValue(
      forgeFailure("RateLimitedError", {
        status: 429,
        body: "",
        resetAt: new Date(Date.now() + 60_000),
        method: "GET",
        url: "u",
      }),
    );
    const client = createForgeClient(() => Promise.resolve(forge), { scope: "s" });

    await expect(client("/a", { retryDelay: 0 })).rejects.toMatchObject({ status: 429 });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("rawFetch", () => {
  it("returns { data, headers, status } from the response", async () => {
    const { forge, request } = fakeForge();
    request.mockResolvedValueOnce(json([1], { headers: { link: '<x>; rel="next"' } }));
    const client = createForgeClient(() => Promise.resolve(forge), { scope: "s" });

    const result = await rawFetch(client, { url: "/a" });

    expect(result.data).toEqual([1]);
    expect(result.status).toBe(200);
    expect(result.headers).toBeInstanceOf(Headers);
  });
});

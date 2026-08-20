import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createCache,
  configureStorage,
  cachedFetch,
  clearCache,
  invalidateCache,
  CACHE_SCOPE,
} from "../src/cache.ts";

function scopedClient(scope: string, ...values: unknown[]) {
  const client = vi.fn();
  for (const value of values) {
    client.mockResolvedValueOnce(value);
  }
  return Object.assign(client, { [CACHE_SCOPE]: scope });
}

describe("cachedFetch", () => {
  beforeEach(() => {
    configureStorage(createCache({ max: 100, ttl: 60_000 }));
  });

  it("fetches from client on cache miss", async () => {
    const client = vi.fn().mockResolvedValue({ id: 1, name: "forges" });

    const result = await cachedFetch(client as any, "/repos/unjs/ugp");

    expect(client).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 1, name: "forges" });
  });

  it("returns cached value on cache hit without calling client", async () => {
    const client = vi.fn().mockResolvedValue({ id: 1, name: "forges" });

    await cachedFetch(client as any, "/repos/unjs/ugp");
    const result = await cachedFetch(client as any, "/repos/unjs/ugp");

    expect(client).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 1, name: "forges" });
  });

  it("does not cache non-GET requests", async () => {
    const client = vi.fn().mockResolvedValue({ id: 1 });

    await cachedFetch(client as any, "/repos", { method: "POST" });
    await cachedFetch(client as any, "/repos", { method: "POST" });

    expect(client).toHaveBeenCalledTimes(2);
  });

  it("differentiates cache entries by URL path", async () => {
    const client = vi.fn().mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ id: 2 });

    const r1 = await cachedFetch(client as any, "/repos/a");
    const r2 = await cachedFetch(client as any, "/repos/b");

    expect(client).toHaveBeenCalledTimes(2);
    expect(r1).toEqual({ id: 1 });
    expect(r2).toEqual({ id: 2 });
  });

  it("reuses cache for equivalent query objects with different key order", async () => {
    const client = vi.fn().mockResolvedValue({ id: 1, name: "forges" });

    const first = await cachedFetch(client as any, "/repos/unjs/ugp", {
      query: { page: "1", state: "open" },
    });
    const second = await cachedFetch(client as any, "/repos/unjs/ugp", {
      query: { state: "open", page: "1" },
    });

    expect(client).toHaveBeenCalledOnce();
    expect(first).toEqual({ id: 1, name: "forges" });
    expect(second).toEqual({ id: 1, name: "forges" });
  });

  it("reuses cache for equivalent query strings with different key order", async () => {
    const client = vi.fn().mockResolvedValue({ id: 1, name: "forges" });

    const first = await cachedFetch(client as any, "/repos/unjs/ugp", {
      query: "page=1&state=open",
    });
    const second = await cachedFetch(client as any, "/repos/unjs/ugp", {
      query: "state=open&page=1",
    });

    expect(client).toHaveBeenCalledOnce();
    expect(first).toEqual({ id: 1, name: "forges" });
    expect(second).toEqual({ id: 1, name: "forges" });
  });

  it("differentiates cache entries by query parameters", async () => {
    const client = vi.fn().mockResolvedValueOnce({ page: 1 }).mockResolvedValueOnce({ page: 2 });

    const first = await cachedFetch(client as any, "/repos", {
      query: { page: "1" },
    });
    const second = await cachedFetch(client as any, "/repos", {
      query: { page: "2" },
    });

    expect(client).toHaveBeenCalledTimes(2);
    expect(first).toEqual({ page: 1 });
    expect(second).toEqual({ page: 2 });
  });

  it("treats empty query like no query", async () => {
    const client = vi.fn().mockResolvedValue({ id: 1, name: "forges" });

    const noQuery = await cachedFetch(client as any, "/repos/unjs/ugp");
    const emptyObject = await cachedFetch(client as any, "/repos/unjs/ugp", {
      query: {},
    });
    const emptyParams = await cachedFetch(client as any, "/repos/unjs/ugp", {
      query: new URLSearchParams(),
    });

    expect(client).toHaveBeenCalledOnce();
    expect(noQuery).toEqual({ id: 1, name: "forges" });
    expect(emptyObject).toEqual({ id: 1, name: "forges" });
    expect(emptyParams).toEqual({ id: 1, name: "forges" });
  });
});

describe("clearCache", () => {
  beforeEach(() => {
    configureStorage(createCache({ max: 100, ttl: 60_000 }));
  });

  it("removes all cached entries", async () => {
    const client = vi
      .fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 1, updated: true });

    await cachedFetch(client as any, "/repos/a");
    await clearCache();
    const result = await cachedFetch(client as any, "/repos/a");

    expect(client).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ id: 1, updated: true });
  });
});

describe("cache scoping", () => {
  beforeEach(() => {
    configureStorage(createCache({ max: 100, ttl: 60_000 }));
  });

  it("does not share entries between clients on different hosts", async () => {
    const saas = scopedClient("https://gitlab.com/api/v4#aaaa", { secret: "saas" });
    const selfHosted = scopedClient("https://git.example.com/api/v4#aaaa", { secret: "self" });

    const url = "/projects/278964/merge_requests/33/discussions/abc";
    expect(await cachedFetch(saas as any, url)).toEqual({ secret: "saas" });
    expect(await cachedFetch(selfHosted as any, url)).toEqual({ secret: "self" });
  });

  it("does not share entries between two tokens on the same host", async () => {
    const alice = scopedClient("https://gitlab.com/api/v4#aaaa", { login: "alice" });
    const bob = scopedClient("https://gitlab.com/api/v4#bbbb", { login: "bob" });

    expect(await cachedFetch(alice as any, "/user")).toEqual({ login: "alice" });
    expect(await cachedFetch(bob as any, "/user")).toEqual({ login: "bob" });
  });

  it("invalidates only the calling client's entry", async () => {
    const alice = scopedClient(
      "https://gitlab.com/api/v4#aaaa",
      { login: "alice" },
      { login: "alice2" },
    );
    const bob = scopedClient("https://gitlab.com/api/v4#bbbb", { login: "bob" });

    await cachedFetch(alice as any, "/user");
    await cachedFetch(bob as any, "/user");
    await invalidateCache(alice as any, "/user");

    expect(await cachedFetch(alice as any, "/user")).toEqual({ login: "alice2" });
    expect(await cachedFetch(bob as any, "/user")).toEqual({ login: "bob" });
    expect(bob).toHaveBeenCalledOnce();
  });
});

describe("invalidateCache", () => {
  beforeEach(() => {
    configureStorage(createCache({ max: 100, ttl: 60_000 }));
  });

  it("removes only the specified cache entry", async () => {
    const client = vi
      .fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce({ id: 1, fresh: true });

    await cachedFetch(client as any, "/repos/a");
    await cachedFetch(client as any, "/repos/b");
    await invalidateCache(client as any, "/repos/a");

    // /repos/a should be re-fetched, /repos/b should still be cached
    const a = await cachedFetch(client as any, "/repos/a");
    const b = await cachedFetch(client as any, "/repos/b");

    expect(client).toHaveBeenCalledTimes(3);
    expect(a).toEqual({ id: 1, fresh: true });
    expect(b).toEqual({ id: 2 });
  });
});

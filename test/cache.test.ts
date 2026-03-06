import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createCache,
  configureStorage,
  cachedFetch,
  clearCache,
  invalidateCache,
} from '../src/cache';

describe('cachedFetch', () => {
  beforeEach(() => {
    configureStorage(createCache({ max: 100, ttl: 60_000 }));
  });

  it('fetches from client on cache miss', async () => {
    const client = vi.fn().mockResolvedValue({ id: 1, name: 'gixa' });

    const result = await cachedFetch(client as any, '/repos/unjs/ugp');

    expect(client).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 1, name: 'gixa' });
  });

  it('returns cached value on cache hit without calling client', async () => {
    const client = vi.fn().mockResolvedValue({ id: 1, name: 'gixa' });

    await cachedFetch(client as any, '/repos/unjs/ugp');
    const result = await cachedFetch(client as any, '/repos/unjs/ugp');

    expect(client).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 1, name: 'gixa' });
  });

  it('does not cache non-GET requests', async () => {
    const client = vi.fn().mockResolvedValue({ id: 1 });

    await cachedFetch(client as any, '/repos', { method: 'POST' });
    await cachedFetch(client as any, '/repos', { method: 'POST' });

    expect(client).toHaveBeenCalledTimes(2);
  });

  it('differentiates cache entries by URL path', async () => {
    const client = vi.fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 });

    const r1 = await cachedFetch(client as any, '/repos/a');
    const r2 = await cachedFetch(client as any, '/repos/b');

    expect(client).toHaveBeenCalledTimes(2);
    expect(r1).toEqual({ id: 1 });
    expect(r2).toEqual({ id: 2 });
  });

  it('reuses cache for equivalent query objects with different key order', async () => {
    const client = vi.fn().mockResolvedValue({ id: 1, name: 'gixa' });

    const first = await cachedFetch(client as any, '/repos/unjs/ugp', {
      query: { page: '1', state: 'open' },
    });
    const second = await cachedFetch(client as any, '/repos/unjs/ugp', {
      query: { state: 'open', page: '1' },
    });

    expect(client).toHaveBeenCalledOnce();
    expect(first).toEqual({ id: 1, name: 'gixa' });
    expect(second).toEqual({ id: 1, name: 'gixa' });
  });

  it('differentiates cache entries by query parameters', async () => {
    const client = vi.fn()
      .mockResolvedValueOnce({ page: 1 })
      .mockResolvedValueOnce({ page: 2 });

    const first = await cachedFetch(client as any, '/repos', {
      query: { page: '1' },
    });
    const second = await cachedFetch(client as any, '/repos', {
      query: { page: '2' },
    });

    expect(client).toHaveBeenCalledTimes(2);
    expect(first).toEqual({ page: 1 });
    expect(second).toEqual({ page: 2 });
  });
});

describe('clearCache', () => {
  beforeEach(() => {
    configureStorage(createCache({ max: 100, ttl: 60_000 }));
  });

  it('removes all cached entries', async () => {
    const client = vi.fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 1, updated: true });

    await cachedFetch(client as any, '/repos/a');
    await clearCache();
    const result = await cachedFetch(client as any, '/repos/a');

    expect(client).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ id: 1, updated: true });
  });
});

describe('invalidateCache', () => {
  beforeEach(() => {
    configureStorage(createCache({ max: 100, ttl: 60_000 }));
  });

  it('removes only the specified cache entry', async () => {
    const client = vi.fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce({ id: 1, fresh: true });

    await cachedFetch(client as any, '/repos/a');
    await cachedFetch(client as any, '/repos/b');
    await invalidateCache('/repos/a');

    // /repos/a should be re-fetched, /repos/b should still be cached
    const a = await cachedFetch(client as any, '/repos/a');
    const b = await cachedFetch(client as any, '/repos/b');

    expect(client).toHaveBeenCalledTimes(3);
    expect(a).toEqual({ id: 1, fresh: true });
    expect(b).toEqual({ id: 2 });
  });
});

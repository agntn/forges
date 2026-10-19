import { vi } from "vite-plus/test";

/** One page of a `forges` listing, as `page()` resolves it. */
export interface FakePage {
  items: unknown[];
  total?: number;
  cursor?: { nextUrl?: string; token?: string };
}

/** A `forges` listing whose single page is `page`. */
export function listing(page: FakePage) {
  return { page: vi.fn(async () => page) };
}

/** Items whose forge payload is each of `raws`, as `forges` wraps them. */
export function raws(...payloads: unknown[]): { raw: unknown }[] {
  return payloads.map((raw) => ({ raw }));
}

/**
 * A stand-in for a `forges` provider: every verb the providers call is a mock,
 * and a listing verb returns whatever listing a test hands it.
 */
export function createFakeForge(forge: string, instance: string) {
  return {
    forge,
    instance,
    refreshCapabilities: vi.fn(async () => ({})),
    request: vi.fn(),
    repos: { get: vi.fn(), byOwner: vi.fn() },
    users: { get: vi.fn(), me: vi.fn() },
    releases: { list: vi.fn(), getByTag: vi.fn(), create: vi.fn(), update: vi.fn() },
    contents: { tags: vi.fn() },
    commits: { list: vi.fn() },
    ci: { runs: vi.fn(), jobs: vi.fn() },
    threads: { list: vi.fn(), comments: vi.fn(), files: vi.fn() },
  };
}

export type FakeForge = ReturnType<typeof createFakeForge>;

const shared = new Map<string, FakeForge>();

/** One fake per forge for the whole test file, so a module mock and the tests share it. */
export function sharedForge(forge: string, instance: string): FakeForge {
  let fake = shared.get(forge);
  if (fake === undefined) {
    fake = createFakeForge(forge, instance);
    shared.set(forge, fake);
  }
  return fake;
}

/** The repository ref the providers hand to `forges`. */
export function repoRef(fake: FakeForge, owner: string, name: string) {
  return { forge: fake.forge, instance: fake.instance, owner, name };
}

/** A listing whose page read fails with `error`. */
export function failing(error: unknown) {
  return {
    page: vi.fn(async () => {
      throw error;
    }),
  };
}

/** The options each mocked `forges` factory was called with, newest last. */
export const forgeOptions: unknown[] = [];

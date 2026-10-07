import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// CI installs the root only; without `docs/node_modules` the one docs dependency is stood in for.
vi.mock("ohash", () => ({ hash: (value: unknown) => `h:${String(value)}` }));

const { assertRateLimit, cachedAnswer, RATE_LIMIT, TTL } =
  await import("../docs/server/utils/query.ts");

type Env = Readonly<Record<string, unknown>>;

interface FakeEvent {
  readonly headers: Readonly<Record<string, string>>;
  readonly context: Readonly<{ cloudflare?: Readonly<{ env: Env }> }>;
}

/** Headers the code under test set on the response, cleared before each test. */
const sentHeaders = new Map<string, unknown>();

function fakeEvent(headers: Readonly<Record<string, string>>, env?: Env): never {
  const event: FakeEvent = { headers, context: env ? { cloudflare: { env } } : {} };
  return event as never;
}

/** KV as the worker sees it: every read and write settles on a later tick. */
function memoryStorage() {
  const items = new Map<string, unknown>();
  return {
    getItem: vi.fn(async (key: string) => {
      await Promise.resolve();
      return items.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: unknown, _options?: unknown) => {
      await Promise.resolve();
      items.set(key, value);
    }),
  };
}

/** The h3 and Nitro auto-imports, reduced to what the rate limit and the cache read. */
function stubAutoImports(storage: ReturnType<typeof memoryStorage>): void {
  vi.stubGlobal(
    "getRequestHeader",
    (event: Readonly<FakeEvent>, name: string) => event.headers[name.toLowerCase()],
  );
  vi.stubGlobal(
    "getRequestIP",
    (event: Readonly<FakeEvent>, options?: Readonly<{ xForwardedFor?: boolean }>) =>
      options?.xForwardedFor ? event.headers["x-forwarded-for"]?.split(",")[0]?.trim() : undefined,
  );
  vi.stubGlobal("setResponseHeader", (_event: unknown, name: string, value: unknown) => {
    sentHeaders.set(name, value);
  });
  vi.stubGlobal("createError", (input: Readonly<{ statusCode: number; statusMessage: string }>) =>
    Object.assign(new Error(input.statusMessage), input),
  );
  vi.stubGlobal("useStorage", () => storage);
}

/** The key `assertRateLimit` hands the `PLATFORM_LIMIT` binding for one client address. */
async function keyFor(address: string): Promise<string | undefined> {
  const keys: string[] = [];
  const limiter = {
    limit: async ({ key }: Readonly<{ key: string }>) => {
      await Promise.resolve();
      keys.push(key);
      return { success: true };
    },
  };
  await assertRateLimit(fakeEvent({ "cf-connecting-ip": address }, { PLATFORM_LIMIT: limiter }));
  return keys[0];
}

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  sentHeaders.clear();
  storage = memoryStorage();
  stubAutoImports(storage);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("docs rate limit", () => {
  it("keys the binding by CF-Connecting-IP, whatever X-Forwarded-For says", async () => {
    const keys: string[] = [];
    const env = {
      PLATFORM_LIMIT: {
        limit: async ({ key }: Readonly<{ key: string }>) => {
          keys.push(key);
          return { success: true };
        },
      },
    };

    for (const spoofed of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) {
      await assertRateLimit(
        fakeEvent(
          { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": `${spoofed}, 203.0.113.7` },
          env,
        ),
      );
    }

    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
  });

  it("answers 429 with Retry-After when the binding refuses", async () => {
    const event = fakeEvent(
      { "cf-connecting-ip": "203.0.113.7" },
      { PLATFORM_LIMIT: { limit: async () => ({ success: false }) } },
    );

    await expect(assertRateLimit(event)).rejects.toMatchObject({ statusCode: 429 });
    expect(sentHeaders.get("Retry-After")).toBe(60);
  });

  it("ignores a rotated X-Forwarded-For without the binding", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-30T12:00:10Z"), toFake: ["Date"] });
    let refused = 0;

    for (let index = 0; index < RATE_LIMIT + 5; index++) {
      const event = fakeEvent({
        "cf-connecting-ip": "198.51.100.9",
        "x-forwarded-for": `10.1.0.${index}`,
      });
      await assertRateLimit(event).catch(() => refused++);
    }

    expect(refused).toBe(5);
  });

  it("holds the limit for a burst of parallel misses without the binding", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-30T12:01:10Z"), toFake: ["Date"] });

    const results = await Promise.allSettled(
      Array.from({ length: RATE_LIMIT + 5 }, () =>
        assertRateLimit(fakeEvent({ "cf-connecting-ip": "198.51.100.10" })),
      ),
    );

    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(5);
  });

  it("counts every address of one IPv6 /64 as one client", async () => {
    const subjects = new Set<string | undefined>();
    for (const address of [
      "2001:db8:1:2::1",
      "2001:db8:1:2:dead:beef:0:7",
      "2001:0DB8:0001:0002:ffff:ffff:ffff:ffff",
    ]) {
      subjects.add(await keyFor(address));
    }

    expect(subjects.size).toBe(1);
  });

  it("keeps neighbouring /64 prefixes apart", async () => {
    expect(await keyFor("2001:db8:1:2::1")).not.toBe(await keyFor("2001:db8:1:3::1"));
  });

  it("finds the /64 behind a compressed prefix", async () => {
    expect(await keyFor("2001:db8::7")).toBe(await keyFor("2001:db8:0:0:ffff::1"));
    expect(await keyFor("::1")).toBe(await keyFor("::2"));
  });

  it("keeps IPv4 clients by their full address, mapped or not", async () => {
    expect(await keyFor("203.0.113.7")).not.toBe(await keyFor("203.0.113.8"));
    expect(await keyFor("::ffff:203.0.113.7")).not.toBe(await keyFor("::ffff:203.0.113.8"));
  });

  it("falls back to the raw header when it is not an address", async () => {
    expect(await keyFor("fe80::1%eth0")).not.toBe(await keyFor("fe80::2%eth0"));
    expect(await keyFor("::1]@example.com/#a")).not.toBe(await keyFor("::1]@example.com/#b"));
  });

  it("gives the binding the number the 429 message quotes", () => {
    const config = readFileSync(new URL("../docs/wrangler.jsonc", import.meta.url), "utf8");
    const binding =
      /"name": "PLATFORM_LIMIT",[^}]*"simple": \{ "limit": (\d+), "period": 60 \}/u.exec(config);

    expect(Number(binding?.[1])).toBe(RATE_LIMIT);
  });
});

interface Bindings {
  readonly vars: Readonly<Record<string, string>>;
  readonly d1_databases: readonly Readonly<{ binding: string; database_id: string }>[];
  readonly kv_namespaces: readonly Readonly<{ binding: string; id: string }>[];
  readonly ratelimits: readonly Readonly<{ name: string }>[];
}

/** The file has trailing commas but no comments, so plain JSON reads it once they go. */
function wranglerConfig(): Bindings & Readonly<{ previews: Bindings }> {
  const text = readFileSync(new URL("../docs/wrangler.jsonc", import.meta.url), "utf8");
  return JSON.parse(text.replaceAll(/,(\s*[\]}])/gu, "$1"));
}

describe("docs previews", () => {
  it("repeats every top-level binding, since a preview inherits none", () => {
    const { previews, ...production } = wranglerConfig();
    const names = (bindings: Bindings) => [
      ...Object.keys(bindings.vars),
      ...bindings.d1_databases.map((database) => database.binding),
      ...bindings.kv_namespaces.map((namespace) => namespace.binding),
      ...bindings.ratelimits.map((limit) => limit.name),
    ];

    expect(names(previews)).toEqual(names(production));
    expect(previews.ratelimits).toEqual(production.ratelimits);
  });

  it("keeps a preview off the database and cache forges.agntn.dev serves", () => {
    const { previews, ...production } = wranglerConfig();

    for (const database of previews.d1_databases) {
      expect(production.d1_databases.map((entry) => entry.database_id)).not.toContain(
        database.database_id,
      );
    }
    for (const namespace of previews.kv_namespaces) {
      expect(production.kv_namespaces.map((entry) => entry.id)).not.toContain(namespace.id);
    }
  });
});

describe("docs answer cache", () => {
  it("writes an answer with its ttl so KV drops it", async () => {
    const event = fakeEvent(
      { "cf-connecting-ip": "203.0.113.7" },
      { PLATFORM_LIMIT: { limit: async () => ({ success: true }) } },
    );

    await cachedAnswer(event, "repo", { owner: "agntn" }, TTL.repo, async () => "answer");

    expect(storage.setItem.mock.calls.map((call) => call[2])).toEqual([{ ttl: TTL.repo }]);
  });
});

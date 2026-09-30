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

  it("gives the binding the number the 429 message quotes", () => {
    const config = readFileSync(new URL("../docs/wrangler.jsonc", import.meta.url), "utf8");
    const binding =
      /"name": "PLATFORM_LIMIT",[^}]*"simple": \{ "limit": (\d+), "period": 60 \}/u.exec(config);

    expect(Number(binding?.[1])).toBe(RATE_LIMIT);
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

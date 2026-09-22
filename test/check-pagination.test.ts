import { afterEach, describe, expect, it, vi } from "vitest";
import { createProvider } from "../src/index.ts";
import { ForgesError } from "../src/errors.ts";

const invalidOptions = [
  { page: 0 },
  { page: -1 },
  { page: 1.5 },
  { page: NaN },
  { page: Infinity },
  { page: Number.MAX_SAFE_INTEGER + 1 },
  { page: Number.MAX_SAFE_INTEGER, perPage: 100 },
  { perPage: 0 },
  { perPage: -1 },
  { perPage: 1.5 },
  { perPage: NaN },
  { perPage: Infinity },
  { perPage: 101 },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(["github", "gitlab", "gitea"] as const)("%s check pagination", (platform) => {
  it.each(invalidOptions)("rejects invalid options %o before HTTP", async (options) => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const provider = await createProvider(platform, { token: "" });

    const result = provider.pullRequests.listChecks("owner", "repo", 1, options);
    await expect(result).rejects.toBeInstanceOf(ForgesError);
    await expect(result).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {},
    { page: 1, perPage: 1 },
    { page: 2, perPage: 100 },
    { page: Math.floor((Number.MAX_SAFE_INTEGER - 1) / 100), perPage: 100 },
  ])("accepts valid options %o and reaches the provider", async (options) => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const provider = await createProvider(platform, { token: "" });

    await expect(
      provider.pullRequests.listChecks("owner", "repo", 1, options),
    ).rejects.toMatchObject({ status: 404, platform });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createProvider } from "../src/index.ts";
import { ForgesError } from "../src/errors.ts";
import { cursorFor } from "./support/cursor.ts";

/** The pull request every valid cursor here continues. */
const CHECKS_SUBJECT = ["owner", "repo", 1];

/** Options no check listing takes, for the listing whose cursors they carry. */
const invalidOptions = (listing: string) => [
  { page: 2 },
  { cursor: cursorFor(listing, { page: 0 }) },
  { cursor: cursorFor(listing, { page: -1 }) },
  { cursor: cursorFor(listing, { page: 1.5 }) },
  { cursor: cursorFor(listing, { page: NaN }) },
  { cursor: cursorFor(listing, { page: Infinity }) },
  { cursor: cursorFor(listing, { page: Number.MAX_SAFE_INTEGER + 1 }) },
  { cursor: cursorFor(listing, { page: Number.MAX_SAFE_INTEGER }), perPage: 100 },
  { cursor: cursorFor("issues.list", { page: 2 }) },
  { cursor: "not a cursor" },
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
  it.each(invalidOptions("pullRequests.listChecks"))(
    "rejects invalid options %o before HTTP",
    async (options) => {
      const fetch = vi.fn(async () => new Response(null, { status: 404 }));
      vi.stubGlobal("fetch", fetch);
      const provider = await createProvider(platform, { token: "" });

      const result = provider.pullRequests.listChecks(
        { owner: "owner", repo: "repo", number: 1 },
        options,
      );
      await expect(result).rejects.toBeInstanceOf(ForgesError);
      await expect(result).rejects.toMatchObject({ status: 400 });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(invalidOptions("commits.listChecks"))(
    "rejects invalid commit check options %o before HTTP",
    async (options) => {
      const fetch = vi.fn(async () => new Response(null, { status: 404 }));
      vi.stubGlobal("fetch", fetch);
      const provider = await createProvider(platform, { token: "" });

      await expect(
        provider.commits.listChecks({ owner: "owner", repo: "repo" }, { ref: "main", ...options }),
      ).rejects.toMatchObject({ status: 400, platform });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    {},
    { perPage: 1 },
    {
      cursor: cursorFor("pullRequests.listChecks", {
        page: 2,
        subject: CHECKS_SUBJECT,
        filters: { perPage: 100 },
      }),
      perPage: 100,
    },
    {
      cursor: cursorFor("pullRequests.listChecks", {
        page: Math.floor((Number.MAX_SAFE_INTEGER - 1) / 100),
        subject: CHECKS_SUBJECT,
        filters: { perPage: 100 },
      }),
      perPage: 100,
    },
  ])("accepts valid options %o and reaches the provider", async (options) => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const provider = await createProvider(platform, { token: "" });

    await expect(
      provider.pullRequests.listChecks({ owner: "owner", repo: "repo", number: 1 }, options),
    ).rejects.toMatchObject({ status: 404, platform });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

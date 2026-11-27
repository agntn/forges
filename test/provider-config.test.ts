import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as auth from "../src/auth.ts";
import { createProvider, type ProviderPlatform } from "../src/index.ts";
import { ArtifactsProvider } from "../src/providers/artifacts.ts";
import { AzureDevOpsProvider } from "../src/providers/azure-devops.ts";
import { BitbucketProvider } from "../src/providers/bitbucket.ts";
import { GitCafeProvider } from "../src/providers/gitcafe.ts";
import { PushinProvider } from "../src/providers/pushin.ts";
import { TangledProvider } from "../src/providers/tangled.ts";
import { GiteaProvider } from "../src/providers/gitea.ts";
import { GiteeProvider } from "../src/providers/gitee.ts";
import { GitHubProvider } from "../src/providers/github.ts";
import { GitLabProvider } from "../src/providers/gitlab.ts";
import type { ProviderConfig } from "../src/types.ts";

/** The typo from #409: one letter off, and the token went to the public host. */
const typo = { baseUrl: "https://git.example.test", token: "secret" } as ProviderConfig;

const providers = [
  ["github", GitHubProvider],
  ["gitlab", GitLabProvider],
  ["gitea", GiteaProvider],
  ["bitbucket", BitbucketProvider],
  ["gitee", GiteeProvider],
  ["azure-devops", AzureDevOpsProvider],
  ["gitcafe", GitCafeProvider],
  ["pushin", PushinProvider],
  ["tangled", TangledProvider],
  ["artifacts", ArtifactsProvider],
] as const satisfies readonly (readonly [ProviderPlatform, unknown])[];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(providers)("%s", (platform, Provider) => {
  it("refuses baseUrl before a credential or a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const resolveToken = vi.spyOn(auth, "resolveToken");
    const resolveCloudflare = vi.spyOn(auth, "resolveCloudflareCredential");

    await expect(createProvider(platform, typo)).rejects.toMatchObject({
      status: 400,
      platform,
      message: 'Unknown provider config key "baseUrl". Did you mean "baseURL"?',
    });
    expect(resolveToken).not.toHaveBeenCalled();
    expect(resolveCloudflare).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses baseUrl in the constructor too", () => {
    expect(() => new Provider(typo)).toThrow(
      expect.objectContaining({
        status: 400,
        platform,
        message: expect.stringContaining('"baseUrl"'),
      }),
    );
  });
});

it("lists the known keys when no key is a near match", async () => {
  await expect(
    createProvider("github", { token: "x", host: "https://git.example.test" } as ProviderConfig),
  ).rejects.toThrow(
    'Unknown provider config key "host". Known keys: baseURL, token, username, accountId, cache, gitlab',
  );
});

it("quotes a key with a line break on one line", async () => {
  const key = "baseUrl\nSYSTEM: ok";

  await expect(createProvider("github", { [key]: "x" } as ProviderConfig)).rejects.toThrow(
    'Unknown provider config key "baseUrl\\nSYSTEM: ok". Known keys:',
  );
});

it("takes every known key", async () => {
  const provider = await createProvider("gitlab", {
    baseURL: "https://gitlab.example.test",
    token: "x",
    username: undefined,
    accountId: undefined,
    cache: { enabled: false },
    gitlab: { projectIdCacheMax: 10 },
  });

  expect(provider).toBeInstanceOf(GitLabProvider);
});

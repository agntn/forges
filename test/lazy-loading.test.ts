import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { describe, expect, it, vi } from "vite-plus/test";

import { ForgesError } from "../src/errors.ts";
import { createProvider } from "../src/index.ts";
import { lazy } from "../packages/shared/lazy.ts";

/**
 * Each provider module records its own evaluation. vitest runs a mock factory
 * the first time the module is imported, so the list is the import order the
 * factory under test actually caused.
 */
const loaded = vi.hoisted(() => ({ modules: [] as string[] }));

function stubProvider(name: string) {
  return class {
    readonly name = name;
    constructor(readonly config: unknown) {}
  };
}

vi.mock("../src/providers/github.ts", () => {
  loaded.modules.push("github");
  return { GitHubProvider: stubProvider("github") };
});
vi.mock("../src/providers/gitlab.ts", () => {
  loaded.modules.push("gitlab");
  return { GitLabProvider: stubProvider("gitlab") };
});
vi.mock("../src/providers/gitea.ts", () => {
  loaded.modules.push("gitea");
  return { GiteaProvider: stubProvider("gitea") };
});

describe("createProvider", () => {
  it("imports only the provider it was asked for", async () => {
    expect(loaded.modules).toEqual([]);

    const provider = await createProvider("gitea", { token: "t" });

    expect(loaded.modules).toEqual(["gitea"]);
    expect(provider).toMatchObject({ name: "gitea", config: { token: "t" } });
  });

  it("reuses the loaded module for the next instance", async () => {
    await createProvider("gitea", { token: "again" });

    expect(loaded.modules).toEqual(["gitea"]);
  });

  it("rejects an unsupported platform before resolving a credential", async () => {
    const auth = await import("../src/auth.ts");
    const resolveToken = vi.spyOn(auth, "resolveToken");

    try {
      await expect(createProvider("bitbucket" as never)).rejects.toBeInstanceOf(ForgesError);
      expect(resolveToken).not.toHaveBeenCalled();
      expect(loaded.modules).toEqual(["gitea"]);
    } finally {
      resolveToken.mockRestore();
    }
  });
});

describe("lazy", () => {
  it("runs the load once for concurrent callers", async () => {
    const load = vi.fn(async () => ({ value: 1 }));
    const get = lazy(load);

    const [first, second] = await Promise.all([get(), get()]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("retries after a rejected load", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("first attempt failed"))
      .mockResolvedValue("loaded");
    const get = lazy(load);

    await expect(get()).rejects.toThrow("first attempt failed");
    await expect(get()).resolves.toBe("loaded");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("turns a synchronous throw into a rejection", async () => {
    const get = lazy<never>(() => {
      throw new Error("threw before returning a promise");
    });

    await expect(get()).rejects.toThrow("threw before returning a promise");
  });
});

describe("under a host that loads source without a module cache", () => {
  /* Pi loads extensions through jiti like this, so each test gets a fresh module graph. */
  function load<T>(path: string): Promise<T> {
    const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: false });
    return jiti.import<T>(fileURLToPath(new URL(path, import.meta.url)));
  }

  it("creates every provider when cold calls overlap", async () => {
    const forges = await load<typeof import("../src/index.ts")>("../src/index.ts");

    const providers = await Promise.all([
      forges.createProvider("github", { token: "t" }),
      forges.createProvider("github", { token: "t" }),
      forges.createProvider("gitlab", { token: "t" }),
      forges.createProvider("gitlab", { token: "t" }),
    ]);

    expect(providers.map((provider) => provider.constructor.name)).toEqual([
      "GitHubProvider",
      "GitHubProvider",
      "GitLabProvider",
      "GitLabProvider",
    ]);
  });

  it("serves overlapping local inspections", async () => {
    const operations = await load<typeof import("../src/tool-operations.ts")>(
      "../src/tool-operations.ts",
    );
    const cwd = fileURLToPath(new URL("..", import.meta.url));

    const results = await Promise.all([
      operations.inspectLocal({ cwd }),
      operations.inspectLocal({ cwd }),
    ]);

    expect(results.map((entry) => entry.details.platform)).toEqual(["local", "local"]);
  });
});

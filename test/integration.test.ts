/**
 * Integration tests
 * - createProvider factory with all platforms
 * - Cross-provider base class consistency
 * - Type exports verification
 */

import { describe, it, expect, vi } from "vitest";

// -- Mock HTTP layer before importing providers --

vi.mock("../src/http.ts", () => ({
  createHttpClient: vi.fn(() => {
    const client = vi.fn().mockResolvedValue({});
    client.raw = vi.fn().mockResolvedValue({
      _data: [],
      headers: new Headers(),
      status: 200,
    });
    return client;
  }),
  rawFetch: vi.fn(async () => ({
    data: [],
    headers: new Headers(),
    status: 200,
  })),
  FetchError: class FetchError extends Error {
    status?: number;
    constructor(msg: string) {
      super(msg);
      this.name = "FetchError";
    }
  },
}));

vi.mock("../src/cache.ts", () => ({
  cachedFetch: vi.fn(async (client: (...args: unknown[]) => unknown, url: string, opts?: unknown) =>
    client(url, opts),
  ),
  createCache: vi.fn(),
  configureStorage: vi.fn(),
  clearCache: vi.fn(async () => {}),
  invalidateCache: vi.fn(async () => {}),
}));

import { createProvider, Provider } from "../src/index.ts";
import { GitHubProvider } from "../src/providers/github.ts";
import { GitLabProvider } from "../src/providers/gitlab.ts";
import { GiteaProvider } from "../src/providers/gitea.ts";
import { AuthenticationError, ForgesError } from "../src/errors.ts";
import type {
  ProviderConfig,
  RepositoryResource,
  IssueResource,
  PullRequestResource,
  UserResource,
  ThreadResource,
} from "../src/types.ts";

// --- createProvider factory ---

describe("createProvider factory", () => {
  const baseConfig: ProviderConfig = {
    baseURL: "https://example.com",
    token: "test-token",
  };

  it("creates a GitHub provider", () => {
    const provider = createProvider("github", baseConfig);

    expect(provider).toBeDefined();
    expect(provider.repos).toBeDefined();
    expect(provider.issues).toBeDefined();
    expect(provider.pullRequests).toBeDefined();
    expect(provider.users).toBeDefined();
  });

  it("creates a GitLab provider", () => {
    const provider = createProvider("gitlab", baseConfig);

    expect(provider).toBeDefined();
    expect(provider.repos).toBeDefined();
    expect(provider.issues).toBeDefined();
    expect(provider.pullRequests).toBeDefined();
    expect(provider.users).toBeDefined();
  });

  it("creates a Gitea provider", () => {
    const provider = createProvider("gitea", baseConfig);

    expect(provider).toBeDefined();
    expect(provider.repos).toBeDefined();
    expect(provider.issues).toBeDefined();
    expect(provider.pullRequests).toBeDefined();
    expect(provider.users).toBeDefined();
  });

  it("throws ForgesError on unsupported platform", () => {
    try {
      // "bitbucket" is invalid by design; cast via never to exercise the runtime guard.
      createProvider("bitbucket" as never, baseConfig);
      throw new Error("expected createProvider to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ForgesError);
      expect((e as ForgesError).platform).toBe("bitbucket");
    }
  });

  it("throws AuthenticationError when no token is found", async () => {
    const auth = await import("../src/auth.ts");
    const spy = vi.spyOn(auth, "resolveToken").mockReturnValue(null);

    try {
      expect(() => createProvider("github")).toThrow(AuthenticationError);
    } finally {
      spy.mockRestore();
    }
  });

  it("GitHub provider is instance of GitHubProvider", () => {
    const provider = createProvider("github", baseConfig);
    expect(provider).toBeInstanceOf(GitHubProvider);
  });

  it("GitLab provider is instance of GitLabProvider", () => {
    const provider = createProvider("gitlab", baseConfig);
    expect(provider).toBeInstanceOf(GitLabProvider);
  });

  it("Gitea provider is instance of GiteaProvider", () => {
    const provider = createProvider("gitea", baseConfig);
    expect(provider).toBeInstanceOf(GiteaProvider);
  });

  it("all concrete providers inherit from Provider", () => {
    expect(createProvider("github", baseConfig)).toBeInstanceOf(Provider);
    expect(createProvider("gitlab", baseConfig)).toBeInstanceOf(Provider);
    expect(createProvider("gitea", baseConfig)).toBeInstanceOf(Provider);
  });
});

// --- Cross-provider class consistency ---

describe("cross-provider class consistency", () => {
  const platforms = ["github", "gitlab", "gitea"] as const;
  const providers: Record<string, Provider> = {};

  for (const platform of platforms) {
    providers[platform] = createProvider(platform, {
      baseURL: "https://example.com",
      token: "test-token",
    });
  }

  it("all providers have repos resource", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.repos).toBeDefined();
      expect(typeof p.repos.list).toBe("function");
      expect(typeof p.repos.get).toBe("function");
    }
  });

  it("all providers have issues resource", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.issues).toBeDefined();
      expect(typeof p.issues.list).toBe("function");
      expect(typeof p.issues.get).toBe("function");
      expect(typeof p.issues.create).toBe("function");
      expect(typeof p.issues.listComments).toBe("function");
    }
  });

  it("all providers have pullRequests resource", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.pullRequests).toBeDefined();
      expect(typeof p.pullRequests.list).toBe("function");
      expect(typeof p.pullRequests.get).toBe("function");
      expect(typeof p.pullRequests.create).toBe("function");
      expect(typeof p.pullRequests.listComments).toBe("function");
    }
  });

  it("all providers have users resource", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.users).toBeDefined();
      expect(typeof p.users.get).toBe("function");
      expect(typeof p.users.authenticated).toBe("function");
    }
  });

  it("all providers have threads resource", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.threads).toBeDefined();
      expect(typeof p.threads.list).toBe("function");
      expect(typeof p.threads.get).toBe("function");
      expect(typeof p.threads.reply).toBe("function");
      expect(typeof p.threads.resolve).toBe("function");
      expect(typeof p.threads.unresolve).toBe("function");
    }
  });

  it("all providers have identical resource method signatures", () => {
    for (const platform of platforms) {
      const p = providers[platform];

      // repos: list(owner, options?) and get(owner, repo)
      expect(p.repos.list.length).toBeGreaterThanOrEqual(1);
      expect(p.repos.get.length).toBeGreaterThanOrEqual(2);

      // issues: list(owner, repo, options?), get(owner, repo, number), create(owner, repo, input)
      expect(p.issues.list.length).toBeGreaterThanOrEqual(2);
      expect(p.issues.get.length).toBeGreaterThanOrEqual(3);
      expect(p.issues.create.length).toBeGreaterThanOrEqual(3);
      expect(p.issues.listComments.length).toBeGreaterThanOrEqual(3);

      // pullRequests: same as issues
      expect(p.pullRequests.list.length).toBeGreaterThanOrEqual(2);
      expect(p.pullRequests.get.length).toBeGreaterThanOrEqual(3);
      expect(p.pullRequests.create.length).toBeGreaterThanOrEqual(3);
      expect(p.pullRequests.listComments.length).toBeGreaterThanOrEqual(3);

      // users: get(username), authenticated()
      expect(p.users.get.length).toBeGreaterThanOrEqual(1);

      // threads: list(owner, repo, number, options?), get/reply/resolve/unresolve
      expect(p.threads.list.length).toBeGreaterThanOrEqual(3);
      expect(p.threads.get.length).toBeGreaterThanOrEqual(4);
      expect(p.threads.reply.length).toBeGreaterThanOrEqual(5);
      expect(p.threads.resolve.length).toBeGreaterThanOrEqual(4);
      expect(p.threads.unresolve.length).toBeGreaterThanOrEqual(4);
    }
  });
});

// --- Type exports verification ---

// Dynamic imports below intentionally verify each public module boundary.

describe("type exports", () => {
  it("exports createProvider function", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.createProvider).toBe("function");
  });

  it("exports the abstract Provider base class", async () => {
    const mod = await import("../src/index.ts");
    expect(mod.Provider).toBe(Provider);
  });

  it("provider sub-path exports the same Provider class", async () => {
    const mod = await import("../src/provider.ts");
    expect(mod.Provider).toBe(Provider);
  });

  it("exports error classes", async () => {
    const mod = await import("../src/index.ts");
    expect(mod.ForgesError).toBeDefined();
    expect(mod.NotFoundError).toBeDefined();
    expect(mod.AuthenticationError).toBeDefined();
    expect(mod.RateLimitError).toBeDefined();
  });

  it("exports normalizeError function", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.normalizeError).toBe("function");
  });

  it("exports pagination utilities", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.parseLinkHeader).toBe("function");
    expect(typeof mod.paginate).toBe("function");
    expect(typeof mod.fetchAllPages).toBe("function");
  });

  it("exports HTTP utilities", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.createHttpClient).toBe("function");
    expect(typeof mod.rawFetch).toBe("function");
  });

  it("exports cache management functions", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.createCache).toBe("function");
    expect(typeof mod.configureStorage).toBe("function");
    expect(typeof mod.cachedFetch).toBe("function");
    expect(typeof mod.clearCache).toBe("function");
    expect(typeof mod.invalidateCache).toBe("function");
  });

  it("exports default as createProvider", async () => {
    const mod = await import("../src/index.ts");
    expect(mod.default).toBe(mod.createProvider);
  });

  it("github sub-path exports GitHubProvider", async () => {
    const mod = await import("../src/github.ts");
    expect(mod.GitHubProvider).toBeDefined();
    expect(typeof mod.GitHubProvider).toBe("function");
  });

  it("gitlab sub-path exports GitLabProvider", async () => {
    const mod = await import("../src/gitlab.ts");
    expect(mod.GitLabProvider).toBeDefined();
    expect(typeof mod.GitLabProvider).toBe("function");
  });

  it("gitea sub-path exports GiteaProvider", async () => {
    const mod = await import("../src/gitea.ts");
    expect(mod.GiteaProvider).toBeDefined();
    expect(typeof mod.GiteaProvider).toBe("function");
  });
});

// --- Provider with direct instantiation ---

describe("direct provider instantiation", () => {
  it("GitHubProvider can be instantiated directly", () => {
    const provider = new GitHubProvider({
      baseURL: "https://api.github.com",
      token: "test",
    });

    expect(provider.repos).toBeDefined();
    expect(provider.issues).toBeDefined();
    expect(provider.pullRequests).toBeDefined();
    expect(provider.users).toBeDefined();
    expect(provider.threads).toBeDefined();
  });

  it("GitLabProvider can be instantiated directly", () => {
    const provider = new GitLabProvider({
      baseURL: "https://gitlab.com/api/v4",
      token: "test",
    });

    expect(provider.repos).toBeDefined();
    expect(provider.issues).toBeDefined();
    expect(provider.pullRequests).toBeDefined();
    expect(provider.users).toBeDefined();
    expect(provider.threads).toBeDefined();
  });

  it("GiteaProvider can be instantiated directly", () => {
    const provider = new GiteaProvider({ token: "test" });

    expect(provider.repos).toBeDefined();
    expect(provider.issues).toBeDefined();
    expect(provider.pullRequests).toBeDefined();
    expect(provider.users).toBeDefined();
    expect(provider.threads).toBeDefined();
  });

  it("GitHubProvider works as GitBucket with custom baseURL", () => {
    const provider = new GitHubProvider({
      baseURL: "http://localhost:8080/api/v3",
      token: "test",
    });

    expect(provider.repos).toBeDefined();
    expect(provider.issues).toBeDefined();
    expect(provider.pullRequests).toBeDefined();
    expect(provider.users).toBeDefined();
    expect(provider.threads).toBeDefined();
  });
});

// --- Type-level consistency (compile-time) ---

describe("type-level consistency", () => {
  it("all providers satisfy the Provider base class", () => {
    // These assignments verify at compile-time that each provider extends Provider.
    const gh: Provider = createProvider("github", { baseURL: "", token: "" });
    const gl: Provider = createProvider("gitlab", { baseURL: "", token: "" });
    const gt: Provider = createProvider("gitea", { baseURL: "", token: "" });

    // Runtime check to use the variables
    expect(gh).toBeDefined();
    expect(gl).toBeDefined();
    expect(gt).toBeDefined();
  });

  it("Provider resource types are assignable", () => {
    const provider = createProvider("github", { baseURL: "", token: "" });

    // These should compile without errors
    const repos: RepositoryResource = provider.repos;
    const issues: IssueResource = provider.issues;
    const prs: PullRequestResource = provider.pullRequests;
    const users: UserResource = provider.users;
    const threads: ThreadResource = provider.threads;

    expect(repos).toBeDefined();
    expect(issues).toBeDefined();
    expect(prs).toBeDefined();
    expect(users).toBeDefined();
    expect(threads).toBeDefined();
  });
});

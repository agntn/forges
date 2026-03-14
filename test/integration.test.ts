/**
 * Integration tests
 * - createProvider factory with all platforms
 * - Cross-provider interface consistency
 * - Type exports verification
 */

import { describe, it, expect, vi } from "vitest";

// -- Mock HTTP layer before importing providers --

vi.mock("../src/http", () => ({
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

vi.mock("../src/cache", () => ({
  cachedFetch: vi.fn(async (client: any, url: string, opts?: any) => client(url, opts)),
  createCache: vi.fn(),
  configureStorage: vi.fn(),
  clearCache: vi.fn(async () => {}),
  invalidateCache: vi.fn(async () => {}),
}));

import { createProvider } from "../src/index";
import { GitHubProvider } from "../src/providers/github";
import { GitLabProvider } from "../src/providers/gitlab";
import { createGiteaProvider } from "../src/providers/gitea";
import { AuthenticationError, GixaError } from "../src/errors";
import type {
  Provider,
  ProviderConfig,
  RepositoryResource,
  IssueResource,
  PullRequestResource,
  UserResource,
} from "../src/types";

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

  it("throws GixaError on unsupported platform", () => {
    try {
      createProvider("bitbucket" as any, baseConfig);
      throw new Error("expected createProvider to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(GixaError);
      expect((e as GixaError).platform).toBe("bitbucket");
    }
  });

  it("throws AuthenticationError when no token is found", async () => {
    const auth = await import("../src/auth");
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

  it("Gitea provider is a plain object with Provider shape", () => {
    const provider = createProvider("gitea", baseConfig);
    // Gitea uses factory function, not class
    expect(typeof provider.repos.list).toBe("function");
    expect(typeof provider.repos.get).toBe("function");
    expect(typeof provider.issues.list).toBe("function");
    expect(typeof provider.issues.get).toBe("function");
    expect(typeof provider.issues.create).toBe("function");
    expect(typeof provider.pullRequests.list).toBe("function");
    expect(typeof provider.pullRequests.get).toBe("function");
    expect(typeof provider.pullRequests.create).toBe("function");
    expect(typeof provider.users.get).toBe("function");
    expect(typeof provider.users.authenticated).toBe("function");
  });
});

// --- Cross-provider interface consistency ---

describe("cross-provider interface consistency", () => {
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
    }
  });

  it("all providers have pullRequests resource", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.pullRequests).toBeDefined();
      expect(typeof p.pullRequests.list).toBe("function");
      expect(typeof p.pullRequests.get).toBe("function");
      expect(typeof p.pullRequests.create).toBe("function");
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

      // pullRequests: same as issues
      expect(p.pullRequests.list.length).toBeGreaterThanOrEqual(2);
      expect(p.pullRequests.get.length).toBeGreaterThanOrEqual(3);
      expect(p.pullRequests.create.length).toBeGreaterThanOrEqual(3);

      // users: get(username), authenticated()
      expect(p.users.get.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// --- Type exports verification ---

describe("type exports", () => {
  it("exports createProvider function", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.createProvider).toBe("function");
  });

  it("exports error classes", async () => {
    const mod = await import("../src/index");
    expect(mod.GixaError).toBeDefined();
    expect(mod.NotFoundError).toBeDefined();
    expect(mod.AuthenticationError).toBeDefined();
    expect(mod.RateLimitError).toBeDefined();
  });

  it("exports normalizeError function", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.normalizeError).toBe("function");
  });

  it("exports pagination utilities", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.parseLinkHeader).toBe("function");
    expect(typeof mod.paginate).toBe("function");
    expect(typeof mod.fetchAllPages).toBe("function");
  });

  it("exports HTTP utilities", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.createHttpClient).toBe("function");
    expect(typeof mod.rawFetch).toBe("function");
  });

  it("exports cache management functions", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.createCache).toBe("function");
    expect(typeof mod.configureStorage).toBe("function");
    expect(typeof mod.cachedFetch).toBe("function");
    expect(typeof mod.clearCache).toBe("function");
    expect(typeof mod.invalidateCache).toBe("function");
  });

  it("exports default as createProvider", async () => {
    const mod = await import("../src/index");
    expect(mod.default).toBe(mod.createProvider);
  });

  it("github sub-path exports GitHubProvider", async () => {
    const mod = await import("../src/github");
    expect(mod.GitHubProvider).toBeDefined();
    expect(typeof mod.GitHubProvider).toBe("function");
  });

  it("gitlab sub-path exports GitLabProvider", async () => {
    const mod = await import("../src/gitlab");
    expect(mod.GitLabProvider).toBeDefined();
    expect(typeof mod.GitLabProvider).toBe("function");
  });

  it("gitea sub-path exports createGiteaProvider", async () => {
    const mod = await import("../src/gitea");
    expect(mod.createGiteaProvider).toBeDefined();
    expect(typeof mod.createGiteaProvider).toBe("function");
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
  });

  it("createGiteaProvider returns a Provider", () => {
    const provider = createGiteaProvider({ token: "test" });

    expect(provider.repos).toBeDefined();
    expect(provider.issues).toBeDefined();
    expect(provider.pullRequests).toBeDefined();
    expect(provider.users).toBeDefined();
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
  });
});

// --- Type-level consistency (compile-time) ---

describe("type-level consistency", () => {
  it("all providers satisfy Provider interface", () => {
    // These assignments verify at compile-time that each provider satisfies Provider
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

    expect(repos).toBeDefined();
    expect(issues).toBeDefined();
    expect(prs).toBeDefined();
    expect(users).toBeDefined();
  });
});

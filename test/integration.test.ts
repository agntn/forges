/**
 * Integration tests
 * - createProvider factory with all platforms
 * - Cross-provider base class consistency
 * - Type exports verification
 */

import { beforeAll, describe, it, expect, vi } from "vitest";

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
  ContributionTemplateResource,
  CodeSearchResource,
  CiRunResource,
  CommitResource,
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

  it("creates a GitHub provider", async () => {
    const provider = await createProvider("github", baseConfig);

    expect(provider).toBeDefined();
    expect(provider.repos).toBeDefined();
    expect(provider.contributionTemplates).toBeDefined();
    expect(provider.code).toBeDefined();
    expect(provider.issues).toBeDefined();
    expect(provider.pullRequests).toBeDefined();
    expect(provider.users).toBeDefined();
  });

  it("creates a GitLab provider", async () => {
    const provider = await createProvider("gitlab", baseConfig);

    expect(provider).toBeDefined();
    expect(provider.repos).toBeDefined();
    expect(provider.contributionTemplates).toBeDefined();
    expect(provider.code).toBeDefined();
    expect(provider.issues).toBeDefined();
    expect(provider.pullRequests).toBeDefined();
    expect(provider.users).toBeDefined();
  });

  it("creates a Gitea provider", async () => {
    const provider = await createProvider("gitea", baseConfig);

    expect(provider).toBeDefined();
    expect(provider.repos).toBeDefined();
    expect(provider.contributionTemplates).toBeDefined();
    expect(provider.code).toBeDefined();
    expect(provider.issues).toBeDefined();
    expect(provider.pullRequests).toBeDefined();
    expect(provider.users).toBeDefined();
  });

  it("throws ForgesError on unsupported platform", async () => {
    // "bitbucket" is invalid by design; cast via never to exercise the runtime guard.
    const failure = createProvider("bitbucket" as never, baseConfig);

    await expect(failure).rejects.toBeInstanceOf(ForgesError);
    await expect(failure).rejects.toMatchObject({ platform: "bitbucket" });
  });

  it("throws AuthenticationError when no token is found", async () => {
    const auth = await import("../src/auth.ts");
    const spy = vi.spyOn(auth, "resolveToken").mockReturnValue(null);

    try {
      await expect(createProvider("github")).rejects.toThrow(AuthenticationError);
    } finally {
      spy.mockRestore();
    }
  });

  it("GitHub provider is instance of GitHubProvider", async () => {
    const provider = await createProvider("github", baseConfig);
    expect(provider).toBeInstanceOf(GitHubProvider);
  });

  it("GitLab provider is instance of GitLabProvider", async () => {
    const provider = await createProvider("gitlab", baseConfig);
    expect(provider).toBeInstanceOf(GitLabProvider);
  });

  it("Gitea provider is instance of GiteaProvider", async () => {
    const provider = await createProvider("gitea", baseConfig);
    expect(provider).toBeInstanceOf(GiteaProvider);
  });

  it("all concrete providers inherit from Provider", async () => {
    expect(await createProvider("github", baseConfig)).toBeInstanceOf(Provider);
    expect(await createProvider("gitlab", baseConfig)).toBeInstanceOf(Provider);
    expect(await createProvider("gitea", baseConfig)).toBeInstanceOf(Provider);
  });

  it.each([
    [
      "listContributionTemplates",
      "Contribution template discovery is not supported by this provider",
    ],
    ["readContributionTemplate", "Contribution template reads are not supported by this provider"],
    ["searchCode", "Code search is not supported by this provider"],
    ["listCiRuns", "CI-run listing is not supported by this provider"],
    ["listPullRequestChecks", "Pull request checks are not supported by this provider"],
    ["listPullRequestReviews", "Pull request reviews are not supported by this provider"],
    ["getPullRequestReview", "Individual pull request reviews are not supported by this provider"],
    ["listReleases", "Releases are not supported by this provider"],
    ["getRelease", "Releases are not supported by this provider"],
    ["createRelease", "Release creation is not supported by this provider"],
    ["updateRelease", "Release updates are not supported by this provider"],
    ["searchIssues", "Issue search is not supported by this provider"],
    ["searchPullRequests", "Pull-request search is not supported by this provider"],
  ])("keeps a default %s fallback for custom providers", async (method, message) => {
    const fallback: unknown = Reflect.get(Provider.prototype, method);
    expect(typeof fallback).toBe("function");
    if (typeof fallback !== "function") throw new Error(`${method} fallback is missing`);

    await expect(fallback()).rejects.toThrow(message);
  });
});

// --- Cross-provider class consistency ---

describe("cross-provider class consistency", () => {
  const platforms = ["github", "gitlab", "gitea"] as const;
  const providers: Record<string, Provider> = {};

  beforeAll(async () => {
    for (const platform of platforms) {
      providers[platform] = await createProvider(platform, {
        baseURL: "https://example.com",
        token: "test-token",
      });
    }
  });

  it("all providers have repos resource", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.repos).toBeDefined();
      expect(typeof p.repos.list).toBe("function");
      expect(typeof p.repos.get).toBe("function");
    }
  });

  it("all providers have contribution-template resources", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.contributionTemplates).toBeDefined();
      expect(typeof p.contributionTemplates.list).toBe("function");
      expect(typeof p.contributionTemplates.get).toBe("function");
    }
  });

  it("all providers have code search resource", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.code).toBeDefined();
      expect(typeof p.code.search).toBe("function");
    }
  });

  it("all providers have CI runs resource", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.ciRuns).toBeDefined();
      expect(typeof p.ciRuns.list).toBe("function");
    }
  });

  it("all providers have releases resource", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.releases).toBeDefined();
      expect(typeof p.releases.list).toBe("function");
      expect(typeof p.releases.get).toBe("function");
      expect(typeof p.releases.create).toBe("function");
      expect(typeof p.releases.update).toBe("function");
    }
  });

  it("all providers have issues resource", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.issues).toBeDefined();
      expect(typeof p.issues.list).toBe("function");
      expect(typeof p.issues.search).toBe("function");
      expect(typeof p.issues.get).toBe("function");
      expect(typeof p.issues.create).toBe("function");
      expect(typeof p.issues.listComments).toBe("function");
      expect(typeof p.issues.getComment).toBe("function");
    }
  });

  it("all providers have pullRequests resource", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.pullRequests).toBeDefined();
      expect(typeof p.pullRequests.list).toBe("function");
      expect(typeof p.pullRequests.listChecks).toBe("function");
      expect(typeof p.pullRequests.listReviews).toBe("function");
      expect(typeof p.pullRequests.search).toBe("function");
      expect(typeof p.pullRequests.get).toBe("function");
      expect(typeof p.pullRequests.create).toBe("function");
      expect(typeof p.pullRequests.listComments).toBe("function");
      expect(typeof p.pullRequests.getComment).toBe("function");
    }
  });

  it("all providers have commits resource", () => {
    for (const platform of platforms) {
      const p = providers[platform];
      expect(p.commits).toBeDefined();
      expect(typeof p.commits.list).toBe("function");
      expect(typeof p.commits.get).toBe("function");
      expect(typeof p.commits.readPatch).toBe("function");
      expect(typeof p.repos.readContents).toBe("function");
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

      expect(p.contributionTemplates.list.length).toBeGreaterThanOrEqual(3);
      expect(p.contributionTemplates.get.length).toBeGreaterThanOrEqual(4);
      expect(p.code.search.length).toBeGreaterThanOrEqual(1);
      expect(p.ciRuns.list.length).toBeGreaterThanOrEqual(2);
      expect(p.commits.list.length).toBeGreaterThanOrEqual(2);
      expect(p.commits.get.length).toBeGreaterThanOrEqual(3);
      expect(p.commits.readPatch.length).toBeGreaterThanOrEqual(3);
      expect(p.repos.readContents.length).toBeGreaterThanOrEqual(3);
      expect(p.releases.list.length).toBeGreaterThanOrEqual(2);
      expect(p.releases.get.length).toBeGreaterThanOrEqual(3);
      expect(p.releases.create.length).toBeGreaterThanOrEqual(3);
      expect(p.releases.update.length).toBeGreaterThanOrEqual(4);

      expect(p.issues.list.length).toBeGreaterThanOrEqual(2);
      expect(p.issues.search.length).toBeGreaterThanOrEqual(3);
      expect(p.issues.get.length).toBeGreaterThanOrEqual(3);
      expect(p.issues.create.length).toBeGreaterThanOrEqual(3);
      expect(p.issues.listComments.length).toBeGreaterThanOrEqual(3);
      expect(p.issues.getComment.length).toBeGreaterThanOrEqual(4);

      // pullRequests: same as issues
      expect(p.pullRequests.list.length).toBeGreaterThanOrEqual(2);
      expect(p.pullRequests.listChecks.length).toBeGreaterThanOrEqual(3);
      expect(p.pullRequests.listReviews.length).toBeGreaterThanOrEqual(3);
      expect(p.pullRequests.search.length).toBeGreaterThanOrEqual(3);
      expect(p.pullRequests.get.length).toBeGreaterThanOrEqual(3);
      expect(p.pullRequests.create.length).toBeGreaterThanOrEqual(3);
      expect(p.pullRequests.listComments.length).toBeGreaterThanOrEqual(3);
      expect(p.pullRequests.getComment.length).toBeGreaterThanOrEqual(4);

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
    expect(provider.code).toBeDefined();
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
    expect(provider.code).toBeDefined();
    expect(provider.issues).toBeDefined();
    expect(provider.pullRequests).toBeDefined();
    expect(provider.users).toBeDefined();
    expect(provider.threads).toBeDefined();
  });

  it("GiteaProvider can be instantiated directly", () => {
    const provider = new GiteaProvider({ token: "test" });

    expect(provider.repos).toBeDefined();
    expect(provider.code).toBeDefined();
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
    expect(provider.code).toBeDefined();
    expect(provider.issues).toBeDefined();
    expect(provider.pullRequests).toBeDefined();
    expect(provider.users).toBeDefined();
    expect(provider.threads).toBeDefined();
  });
});

// --- Type-level consistency (compile-time) ---

describe("type-level consistency", () => {
  it("all providers satisfy the Provider base class", async () => {
    // These assignments verify at compile-time that each provider extends Provider.
    const gh: Provider = await createProvider("github", { baseURL: "", token: "" });
    const gl: Provider = await createProvider("gitlab", { baseURL: "", token: "" });
    const gt: Provider = await createProvider("gitea", { baseURL: "", token: "" });

    // Runtime check to use the variables
    expect(gh).toBeDefined();
    expect(gl).toBeDefined();
    expect(gt).toBeDefined();
  });

  it("Provider resource types are assignable", async () => {
    const provider = await createProvider("github", { baseURL: "", token: "" });

    // These should compile without errors
    const repos: RepositoryResource = provider.repos;
    const contributionTemplates: ContributionTemplateResource = provider.contributionTemplates;
    const code: CodeSearchResource = provider.code;
    const ciRuns: CiRunResource = provider.ciRuns;
    const commits: CommitResource = provider.commits;
    const issues: IssueResource = provider.issues;
    const prs: PullRequestResource = provider.pullRequests;
    const users: UserResource = provider.users;
    const threads: ThreadResource = provider.threads;

    expect(repos).toBeDefined();
    expect(contributionTemplates).toBeDefined();
    expect(code).toBeDefined();
    expect(ciRuns).toBeDefined();
    expect(commits).toBeDefined();
    expect(issues).toBeDefined();
    expect(prs).toBeDefined();
    expect(users).toBeDefined();
    expect(threads).toBeDefined();
  });
});

/** What createProvider builds, what each entry exports, what a custom provider inherits. */

import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, it, expect, vi } from "vite-plus/test";

import { createProvider, Provider } from "../src/index.ts";
import { ArtifactsProvider } from "../src/providers/artifacts.ts";
import { GitHubProvider } from "../src/providers/github.ts";
import { GitLabProvider } from "../src/providers/gitlab.ts";
import { GiteaProvider } from "../src/providers/gitea.ts";
import { AuthenticationError, ForgesError } from "../src/errors.ts";

describe("createProvider factory", () => {
  const baseConfig = { baseURL: "https://example.com", token: "test-token" };

  it.each([
    ["github", GitHubProvider],
    ["gitlab", GitLabProvider],
    ["gitea", GiteaProvider],
  ] as const)("builds the %s provider", async (platform, ProviderClass) => {
    expect(await createProvider(platform, baseConfig)).toBeInstanceOf(ProviderClass);
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

  it.each([
    [
      "listContributionTemplates",
      "Contribution template discovery is not supported by this provider",
    ],
    ["readContributionTemplate", "Contribution template reads are not supported by this provider"],
    ["searchCode", "Code search is not supported by this provider"],
    ["listTags", "Tag listing is not supported by this provider"],
    ["listCiRuns", "CI-run listing is not supported by this provider"],
    ["listPullRequestChecks", "Pull request checks are not supported by this provider"],
    ["listCommitChecks", "Commit checks are not supported by this provider"],
    ["listPullRequestReviews", "Pull request reviews are not supported by this provider"],
    ["getPullRequestReview", "Individual pull request reviews are not supported by this provider"],
    ["listReleases", "Releases are not supported by this provider"],
    ["getRelease", "Releases are not supported by this provider"],
    ["createRelease", "Release creation is not supported by this provider"],
    ["updateRelease", "Release updates are not supported by this provider"],
    ["updateIssue", "Issue updates are not supported by this provider"],
    ["updatePullRequest", "Pull request updates are not supported by this provider"],
    ["mergePullRequest", "Pull request merges are not supported by this provider"],
    ["createIssueComment", "Issue comments are not supported by this provider"],
    ["createPullRequestComment", "Pull request comments are not supported by this provider"],
    ["listIssueReactions", "Issue reactions are not supported by this provider"],
    ["listPullRequestReactions", "Pull request reactions are not supported by this provider"],
    ["searchIssues", "Issue search is not supported by this provider"],
    ["searchPullRequests", "Pull-request search is not supported by this provider"],
  ])("keeps a default %s fallback for custom providers", async (method, message) => {
    const fallback: unknown = Reflect.get(Provider.prototype, method);
    if (typeof fallback !== "function") throw new Error(`${method} fallback is missing`);

    const provider: unknown = Reflect.construct(Provider, []);

    await expect(Reflect.apply(fallback, provider, [])).rejects.toThrow(message);
  });
});

describe("entry points", () => {
  it("exports the runtime API from the package root", async () => {
    const mod = await import("../src/index.ts");

    expect(Object.keys(mod).sort()).toEqual([
      "AuthenticationError",
      "FetchError",
      "ForgesError",
      "NotFoundError",
      "PermissionError",
      "Provider",
      "RateLimitError",
      "cachedFetch",
      "clearCache",
      "configureStorage",
      "createCache",
      "createHttpClient",
      "createProvider",
      "default",
      "fetchAllPages",
      "invalidateCache",
      "normalizeError",
      "paginate",
      "parseLinkHeader",
      "rawFetch",
      "resolveToken",
    ]);
    expect(mod.default).toBe(createProvider);
  });

  it.each([
    ["provider", () => import("../src/provider.ts"), { Provider }],
    ["github", () => import("../src/github.ts"), { GitHubProvider, Provider }],
    ["gitlab", () => import("../src/gitlab.ts"), { GitLabProvider, Provider }],
    ["gitea", () => import("../src/gitea.ts"), { GiteaProvider, Provider }],
    ["artifacts", () => import("../src/artifacts.ts"), { ArtifactsProvider, Provider }],
  ])("the %s sub-path exports its classes and nothing else", async (_, load, classes) => {
    expect({ ...(await load()) }).toEqual(classes);
  });
});

describe("entry point types", () => {
  const entries = ["index", "github", "gitlab", "gitea", "artifacts"] as const;
  const exported = new Map<string, string[]>();

  /** Ask the compiler, not a regex: it follows star exports the way a consumer's tsc does. */
  beforeAll(() => {
    const files = new Map(
      ["types", ...entries].map((name) => [
        name,
        fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)),
      ]),
    );
    const program = ts.createProgram([...files.values()], {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ESNext,
      allowImportingTsExtensions: true,
      noEmit: true,
    });
    const checker = program.getTypeChecker();

    for (const [name, file] of files) {
      const source = program.getSourceFile(file);
      const module = source && checker.getSymbolAtLocation(source);
      exported.set(name, module ? checker.getExportsOfModule(module).map(({ name }) => name) : []);
    }
  });

  it.each(entries)("the %s entry exports every type from types.ts", (entry) => {
    const types = exported.get("types") ?? [];
    const names = exported.get(entry) ?? [];

    expect(types.length).toBeGreaterThan(0);
    expect(types.filter((name) => !names.includes(name))).toEqual([]);
  });
});

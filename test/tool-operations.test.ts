import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FetchError } from "ofetch";

import { AuthenticationError, NotFoundError, RateLimitError } from "../src/errors.ts";
import {
  createIssue,
  createIssueComment,
  createPullRequestComment,
  createRelease,
  getAuthenticatedUser,
  getContributionTemplate,
  getRepository,
  listContributionTemplates,
  listRepositories,
  reloadAuthentication,
  searchCode,
  resetPinnedProviders,
  updatePullRequest,
} from "../src/tool-operations.ts";

const mocks = vi.hoisted(() => {
  /**
   * Stands in for the account the credential chain resolves to. `gh auth token` and
   * the CLI config files are global state, so another process can move this between
   * two tool calls without the server noticing.
   */
  const localLogin = { current: "aeitwoen" };
  const credentialToken = { current: "test-token" as string | null };
  const anonymousWrites = { current: 0 };
  const issueCreateGate = { current: undefined as Promise<void> | undefined };
  /** Logins `gh auth token --user` can answer for; the token names its owner. */
  const ghLogins = { current: new Set(["aeitwoen", "oritwoen"]) };
  /** A `GH_TOKEN` in the environment answers every lookup, a named account's too. */
  const envCredential = { current: false };
  const issueAuthors = { current: [] as string[] };
  /** One rejection handed to every caller, the way GitLab shares an in-flight project lookup. */
  const sharedRefusal = { current: new Error("unset") };

  const resolveToken = vi.fn((_platform: string, options?: { account?: string }) => {
    const account = options?.account;
    if (account !== undefined && !envCredential.current) {
      return ghLogins.current.has(account)
        ? { token: `account:${account}`, source: "cli" as const }
        : null;
    }
    const token = credentialToken.current;
    return token === null ? null : { token, source: "env" as const };
  });

  const createProvider = vi.fn(
    (_platform: string, config?: { baseURL?: string; token?: string }) => {
      const anonymous = config?.token === "";
      const namedLogin = config?.token?.startsWith("account:") ? config.token.slice(8) : undefined;
      const login = anonymous ? "anonymous" : (namedLogin ?? localLogin.current);

      return {
        contributionTemplates: {
          list: vi.fn(async (_owner: string, _repo: string, kind: string, options: unknown) => ({
            items: [
              {
                kind,
                key: "agntn/.github:.github/ISSUE_TEMPLATE/bug.yml",
                name: "bug",
                scope: "owner",
                inherited: true,
                sourceRepository: "agntn/.github",
                sourcePath: ".github/ISSUE_TEMPLATE/bug.yml",
                sourceRef: "main",
              },
            ],
            totalCount: 1,
            hasNextPage: false,
            options,
          })),
          get: vi.fn(async (_owner: string, _repo: string, kind: string, key: string) => ({
            kind,
            key,
            name: "bug",
            scope: "owner",
            inherited: true,
            sourceRepository: "agntn/.github",
            sourcePath: ".github/ISSUE_TEMPLATE/bug.yml",
            sourceRef: "main",
            content: "name: Bug report\nbody: []\n",
          })),
        },
        code: {
          search: vi.fn(async (query: string, options: unknown) => ({
            items: [
              {
                repository: "agntn/forges",
                path: "src/provider.ts",
                url: "https://github.com/agntn/forges/blob/main/src/provider.ts",
              },
            ],
            query,
            options,
            incomplete: false,
            hasNextPage: false,
          })),
        },
        repos: {
          list: vi.fn(),
          get: vi.fn(async (owner: string, repo: string) => {
            if (repo === "missing" || (repo === "hidden" && anonymous)) {
              throw new NotFoundError("Resource not found: 404 ", "github", new FetchError("404"));
            }
            if (repo === "shared" && anonymous) throw sharedRefusal.current;
            if (repo === "busy" && anonymous) {
              throw new RateLimitError(
                "Rate limit exceeded: 403",
                60,
                "github",
                new FetchError("403"),
              );
            }
            if (repo === "gone") throw new NotFoundError("Repository not found: gone", "github");
            return {
              id: "1",
              name: repo,
              fullName: `${owner}/${repo}`,
              owner: { login },
              private: false,
              defaultBranch: "main",
            };
          }),
        },
        issues: {
          create: vi.fn(async (_owner: string, _repo: string, input: { title: string }) => {
            if (anonymous) {
              anonymousWrites.current += 1;
            }
            await issueCreateGate.current;
            issueAuthors.current.push(login);
            return {
              id: "7",
              number: 7,
              title: input.title,
              state: "open",
              author: { login },
            };
          }),
          createComment: vi.fn(async (_owner: string, _repo: string, _number: number) => {
            if (anonymous) {
              anonymousWrites.current += 1;
            }
            return { id: "31", body: "posted", author: { login } };
          }),
        },
        pullRequests: {
          // A platform that keeps its one assignee, the way GitLab Free does.
          update: vi.fn(async (_owner: string, _repo: string, number: number) => ({
            number,
            assignees: [{ login: "maintainer" }],
            updatedBy: login,
          })),
          createComment: vi.fn(async () => ({ id: "32", body: "posted", author: { login } })),
        },
        users: {
          authenticated: vi.fn(async () => ({ id: "1", login })),
        },
      };
    },
  );

  return {
    localLogin,
    credentialToken,
    anonymousWrites,
    issueCreateGate,
    ghLogins,
    envCredential,
    issueAuthors,
    sharedRefusal,
    resolveToken,
    createProvider,
  };
});

vi.mock("../src/index.ts", () => ({
  createProvider: mocks.createProvider,
  resolveToken: mocks.resolveToken,
}));

const issueParams = {
  platform: "github",
  owner: "agntn",
  repo: "forges",
  title: "Pin write identity",
  body: "The write should land under the confirmed account.",
} as const;

beforeEach(() => {
  resetPinnedProviders();
  mocks.localLogin.current = "aeitwoen";
  mocks.credentialToken.current = "test-token";
  mocks.anonymousWrites.current = 0;
  mocks.issueCreateGate.current = undefined;
  mocks.ghLogins.current = new Set(["aeitwoen", "oritwoen"]);
  mocks.envCredential.current = false;
  mocks.issueAuthors.current = [];
  mocks.sharedRefusal.current = new NotFoundError(
    "Resource not found: 404",
    "gitlab",
    new FetchError("404"),
  );
  mocks.resolveToken.mockClear();
  mocks.createProvider.mockClear();
  vi.stubEnv("FORGES_GITHUB_BASE_URL", undefined);
  vi.stubEnv("FORGES_GITEA_BASE_URL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configured provider", () => {
  it("serializes results as compact JSON that still parses to the details", async () => {
    const read = await getContributionTemplate({
      platform: "github",
      owner: "agntn",
      repo: "forges",
      kind: "issue",
      key: "agntn/.github:.github/ISSUE_TEMPLATE/bug.yml",
    });
    const text = read.content[0].text;

    expect(text).toBe(JSON.stringify(read.details));
    expect(text).not.toMatch(/\n/);
    expect(JSON.parse(text)).toEqual(read.details);
    expect(JSON.parse(text).result.content).toBe("name: Bug report\nbody: []\n");
  });

  it("lists template metadata without bodies and reads one exact key in full", async () => {
    const listed = await listContributionTemplates({
      platform: "github",
      owner: "agntn",
      repo: "forges",
      kind: "issue",
      page: 2,
      perPage: 10,
    });
    const summary = listed.details.result.items[0]!;
    const read = await getContributionTemplate({
      platform: "github",
      owner: "agntn",
      repo: "forges",
      kind: "issue",
      key: summary.key,
    });

    expect(summary).not.toHaveProperty("content");
    expect(listed.content[0].text).toContain("use forges_contribution_templates_get");
    expect(read.details.result.content).toBe("name: Bug report\nbody: []\n");
  });

  it("passes optional scope and pagination to code search", async () => {
    const searched = await searchCode({
      platform: "github",
      query: "Provider",
      owner: "agntn",
      repo: "forges",
      page: 2,
      perPage: 10,
    });

    expect(searched.details.result).toMatchObject({
      query: "Provider",
      options: { owner: "agntn", repo: "forges", page: 2, perPage: 10 },
    });
  });

  it("writes as the account the authenticated check named, even after the local login moves", async () => {
    const identity = await getAuthenticatedUser({ platform: "github" });
    // Another process runs `gh auth switch` between the confirmation and the write.
    mocks.localLogin.current = "oritwoen";

    const created = await createIssue(issueParams);

    expect(identity.details.result.login).toBe("aeitwoen");
    expect(created.details.result.author.login).toBe("aeitwoen");
    expect(mocks.createProvider).toHaveBeenCalledTimes(1);
  });

  it("keeps a credential found by a public read pinned for a later write", async () => {
    await getRepository({ platform: "github", owner: "agntn", repo: "forges" });
    mocks.localLogin.current = "oritwoen";

    const created = await createIssue(issueParams);

    expect(created.details.result.author.login).toBe("aeitwoen");
    expect(mocks.createProvider).toHaveBeenCalledTimes(1);
  });

  it("rejects too many assignees before resolving credentials", async () => {
    await expect(
      createIssue({
        ...issueParams,
        assignees: Array.from({ length: 11 }, (_, index) => `user-${index}`),
      }),
    ).rejects.toThrow("Assignees must be an array of at most 10 non-empty logins");

    expect(mocks.resolveToken).not.toHaveBeenCalled();
    expect(mocks.createProvider).not.toHaveBeenCalled();
  });

  it("updates a pull request as the named account and says which assignee change did not apply", async () => {
    const updated = await updatePullRequest({
      repo: "agntn/forges",
      number: 5,
      addAssignees: ["reviewer"],
      removeAssignees: ["Maintainer"],
      account: "oritwoen",
    });

    expect(updated.details.result).toMatchObject({ number: 5, updatedBy: "oritwoen" });
    expect(JSON.parse(updated.content[0].text).note).toBe(
      "Update succeeded, but the assignees did not change as asked (not assigned: reviewer; still assigned: Maintainer). The result shows who is assigned now.",
    );
  });

  it("leaves the note out when the assignees changed as asked", async () => {
    const updated = await updatePullRequest({
      repo: "agntn/forges",
      number: 5,
      body: "Closes #168.",
      addAssignees: ["maintainer"],
    });

    expect(JSON.parse(updated.content[0].text).note).toBeUndefined();
  });

  it("rejects an update that changes nothing before resolving credentials", async () => {
    await expect(
      updatePullRequest({ repo: "agntn/forges", number: 5, addLabels: [] }),
    ).rejects.toThrow("Pull request update needs at least one change");

    expect(mocks.resolveToken).not.toHaveBeenCalled();
    expect(mocks.createProvider).not.toHaveBeenCalled();
  });

  it("falls back to anonymous public reads without making writes anonymous", async () => {
    mocks.credentialToken.current = null;

    const repository = await getRepository({ platform: "github", owner: "agntn", repo: "forges" });

    expect(repository.details.result.owner.login).toBe("anonymous");
    await expect(getAuthenticatedUser({ platform: "github" })).rejects.toThrow(AuthenticationError);
    await expect(createIssue(issueParams)).rejects.toThrow(AuthenticationError);
    await expect(
      createIssueComment({ repo: "agntn/forges", number: 7, body: "posted" }),
    ).rejects.toThrow(AuthenticationError);
    expect(mocks.anonymousWrites.current).toBe(0);
  });

  it("says a tokenless read was refused for want of a token", async () => {
    mocks.credentialToken.current = null;

    const refused = getRepository({ repo: "oritwoen/hidden" });

    await expect(refused).rejects.toThrow(NotFoundError);
    await expect(refused).rejects.toThrow(
      "Resource not found: 404. The request carried no token, and github answers 404 for a private repository as well as a missing one. Set GITHUB_TOKEN or log in with `gh auth login`. Then retry.",
    );
    await expect(refused).rejects.toMatchObject({ status: 404, platform: "github" });

    const throttled = getRepository({ repo: "agntn/busy" });

    await expect(throttled).rejects.toThrow(
      "Rate limit exceeded: 403. The request carried no token, and requests without one get a far lower rate limit.",
    );
    await expect(throttled).rejects.toMatchObject({ retryAfter: 60 });
  });

  it("explains a refusal shared by concurrent reads once", async () => {
    mocks.credentialToken.current = null;

    const refusals = await Promise.allSettled([
      getRepository({ repo: "agntn/shared" }),
      getRepository({ repo: "agntn/shared" }),
    ]);

    for (const refusal of refusals) {
      expect(refusal.status).toBe("rejected");
      if (refusal.status === "rejected") {
        expect(String(refusal.reason.message).match(/Then retry\./g)).toHaveLength(1);
      }
    }
  });

  it("leaves a 404 alone when a token was sent or the provider found nothing", async () => {
    await expect(getRepository({ repo: "oritwoen/missing" })).rejects.toThrow(
      /^Resource not found: 404 $/,
    );

    resetPinnedProviders();
    mocks.credentialToken.current = null;
    await expect(getRepository({ repo: "oritwoen/gone" })).rejects.toThrow(
      /^Repository not found: gone$/,
    );
  });

  it("posts a comment as the named account, never the local one", async () => {
    const issueComment = await createIssueComment({
      repo: "agntn/forges",
      number: 7,
      body: "posted",
      account: "oritwoen",
    });
    const pullRequestComment = await createPullRequestComment({
      repo: "agntn/forges",
      number: 5,
      body: "posted",
      account: "oritwoen",
    });

    expect(issueComment.details.result.author.login).toBe("oritwoen");
    expect(pullRequestComment.details.result.author.login).toBe("oritwoen");
  });

  it("replaces an anonymous read provider when credentials appear", async () => {
    mocks.credentialToken.current = null;
    const anonymous = await getRepository({
      platform: "github",
      owner: "agntn",
      repo: "forges",
    });
    mocks.credentialToken.current = "test-token";

    const authenticated = await getRepository({
      platform: "github",
      owner: "agntn",
      repo: "forges",
    });

    expect(anonymous.details.result.owner.login).toBe("anonymous");
    expect(authenticated.details.result.owner.login).toBe("aeitwoen");
    expect(mocks.createProvider).toHaveBeenCalledTimes(2);
  });

  it("treats an explicitly empty detected token as anonymous", async () => {
    mocks.credentialToken.current = "";

    const repository = await getRepository({ platform: "github", owner: "agntn", repo: "forges" });

    expect(repository.details.result.owner.login).toBe("anonymous");
    await expect(createIssue(issueParams)).rejects.toThrow(
      "Set GITHUB_TOKEN or log in with `gh auth login`.",
    );
    expect(mocks.anonymousWrites.current).toBe(0);
  });

  it("resolves separately for each platform and endpoint", async () => {
    await getRepository({ platform: "github", owner: "agntn", repo: "forges" });
    await getRepository({ platform: "gitea", owner: "agntn", repo: "forges" });
    vi.stubEnv("FORGES_GITEA_BASE_URL", "https://gitea.example.com/api/v1");
    await getRepository({ platform: "gitea", owner: "agntn", repo: "forges" });
    // An endpoint variable set but left empty is its own configuration, not the unset one.
    vi.stubEnv("FORGES_GITEA_BASE_URL", "");
    await getRepository({ platform: "gitea", owner: "agntn", repo: "forges" });

    expect(mocks.resolveToken.mock.calls).toEqual([
      ["github", { baseURL: undefined }],
      ["gitea", { baseURL: undefined }],
      ["gitea", { baseURL: "https://gitea.example.com/api/v1" }],
      ["gitea", { baseURL: "" }],
    ]);
    expect(mocks.createProvider.mock.calls).toEqual([
      ["github", { token: "test-token" }],
      ["gitea", { token: "test-token" }],
      ["gitea", { baseURL: "https://gitea.example.com/api/v1", token: "test-token" }],
      ["gitea", { baseURL: "", token: "test-token" }],
    ]);
  });

  it("resolves the credential again once the pin is dropped", async () => {
    const before = await getAuthenticatedUser({ platform: "github" });
    mocks.localLogin.current = "oritwoen";
    resetPinnedProviders();

    const after = await getAuthenticatedUser({ platform: "github" });

    expect(before.details.result.login).toBe("aeitwoen");
    expect(after.details.result.login).toBe("oritwoen");
  });

  it("can refresh one platform without dropping another platform's pin", async () => {
    await getAuthenticatedUser({ platform: "github" });
    await getAuthenticatedUser({ platform: "gitea" });
    mocks.localLogin.current = "oritwoen";

    const refreshed = await reloadAuthentication({ platform: "github" });

    const untouched = await getAuthenticatedUser({ platform: "gitea" });
    expect(refreshed.details.result.login).toBe("oritwoen");
    expect(untouched.details.result.login).toBe("aeitwoen");
  });

  it("rejects reload when the replacement credential is missing", async () => {
    await getAuthenticatedUser({ platform: "github" });
    mocks.credentialToken.current = null;

    await expect(reloadAuthentication({ platform: "github" })).rejects.toThrow(AuthenticationError);
    await expect(createIssue(issueParams)).rejects.toThrow(AuthenticationError);
  });

  it("waits for an in-flight write before replacing its platform credential", async () => {
    const writeGate = Promise.withResolvers<void>();
    mocks.issueCreateGate.current = writeGate.promise;
    const write = createIssue(issueParams);
    await vi.waitFor(() => expect(mocks.createProvider).toHaveBeenCalledTimes(1));
    mocks.localLogin.current = "oritwoen";

    const reload = reloadAuthentication({ platform: "github" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mocks.createProvider).toHaveBeenCalledTimes(1);

    writeGate.resolve();
    await write;
    const reloaded = await reload;
    expect(reloaded.details.result.login).toBe("oritwoen");
  });
});

describe("named account", () => {
  it("writes as the named login and leaves the default pin alone", async () => {
    await getAuthenticatedUser({ platform: "github" });

    const created = await createIssue({ ...issueParams, account: "oritwoen" });
    const named = await getAuthenticatedUser({ platform: "github", account: "OriTwoEn" });
    const fallback = await getAuthenticatedUser({ platform: "github" });

    expect(created.details.result.author.login).toBe("oritwoen");
    expect(named.details.result.login).toBe("oritwoen");
    expect(fallback.details.result.login).toBe("aeitwoen");
    expect(mocks.resolveToken).toHaveBeenCalledWith("github", {
      baseURL: undefined,
      account: "oritwoen",
    });
    // One default provider and one pinned per account, whatever the login's case.
    expect(mocks.createProvider).toHaveBeenCalledTimes(2);
  });

  it("refuses a login gh has no token for and writes nothing", async () => {
    await expect(createIssue({ ...issueParams, account: "ghost" })).rejects.toThrow(
      'No auth token found for github account "ghost"',
    );

    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.issueAuthors.current).toEqual([]);
  });

  it("refuses an env token that belongs to another login", async () => {
    mocks.envCredential.current = true;

    const write = createIssue({ ...issueParams, account: "oritwoen" });

    await expect(write).rejects.toThrow(AuthenticationError);
    await expect(write).rejects.toThrow(/belongs to "aeitwoen"\. GH_TOKEN or GITHUB_TOKEN/);
    expect(mocks.issueAuthors.current).toEqual([]);
  });

  it("accepts an env token that belongs to the named login", async () => {
    mocks.envCredential.current = true;

    const created = await createIssue({ ...issueParams, account: "aeitwoen" });

    expect(created.details.result.author.login).toBe("aeitwoen");
  });

  it("does not pin a refused account", async () => {
    mocks.envCredential.current = true;
    await expect(createIssue({ ...issueParams, account: "oritwoen" })).rejects.toThrow();
    mocks.envCredential.current = false;

    const created = await createIssue({ ...issueParams, account: "oritwoen" });

    expect(created.details.result.author.login).toBe("oritwoen");
  });

  it("rejects an account on platforms whose CLI cannot pick a login", async () => {
    await expect(
      createIssue({ ...issueParams, platform: "gitlab", account: "oritwoen" }),
    ).rejects.toThrow("Choosing an account is supported only on github");

    expect(mocks.resolveToken).not.toHaveBeenCalled();
  });

  it("drops account pins on reload", async () => {
    await getAuthenticatedUser({ platform: "github", account: "oritwoen" });
    mocks.ghLogins.current = new Set(["aeitwoen"]);

    await reloadAuthentication({ platform: "github" });

    await expect(getAuthenticatedUser({ platform: "github", account: "oritwoen" })).rejects.toThrow(
      AuthenticationError,
    );
  });
});

describe("provider loading", () => {
  const repositoryParams = { platform: "github", owner: "agntn", repo: "forges" } as const;

  it("shares one provider load between concurrent cold reads", async () => {
    await Promise.all([getRepository(repositoryParams), getRepository(repositoryParams)]);

    expect(mocks.createProvider).toHaveBeenCalledTimes(1);
  });

  it("retries a provider load that failed", async () => {
    mocks.createProvider.mockImplementationOnce(() => {
      throw new Error("provider module failed to load");
    });

    await expect(getRepository(repositoryParams)).rejects.toThrow("provider module failed to load");
    await expect(getRepository(repositoryParams)).resolves.toBeDefined();

    expect(mocks.createProvider).toHaveBeenCalledTimes(2);
  });

  it("does not pin a credential whose provider failed to load", async () => {
    mocks.createProvider.mockImplementationOnce(() => {
      throw new Error("provider module failed to load");
    });
    await expect(getAuthenticatedUser({ platform: "github" })).rejects.toThrow(
      "provider module failed to load",
    );
    mocks.localLogin.current = "oritwoen";

    const identity = await getAuthenticatedUser({ platform: "github" });

    expect(identity.details.result.login).toBe("oritwoen");
  });
});

describe("repository target", () => {
  it("reads a repository written as one owner/name slug, on github by default", async () => {
    const read = await getRepository({ repo: "agntn/keys" });

    expect(mocks.createProvider).toHaveBeenCalledWith("github", { token: "test-token" });
    expect(read.details).toMatchObject({
      platform: "github",
      result: { name: "keys", fullName: "agntn/keys" },
    });
  });

  it("keeps the long form answering as it did", async () => {
    const read = await getRepository({ platform: "github", owner: "agntn", repo: "keys" });

    expect(read.details.result.fullName).toBe("agntn/keys");
  });

  it("scopes a search from the slug and leaves an unscoped search global", async () => {
    const scoped = await searchCode({ query: "Provider", repo: "agntn/forges" });
    const global = await searchCode({ query: "Provider" });

    expect(scoped.details.result).toMatchObject({
      options: { owner: "agntn", repo: "forges" },
    });
    expect(global.details.result).toMatchObject({
      options: { owner: undefined, repo: undefined },
    });
  });

  it("refuses an owner passed twice rather than picking one", async () => {
    await expect(getRepository({ owner: "agntn", repo: "oritwoen/keys" })).rejects.toThrow(
      /Ambiguous repository/,
    );
  });

  it("refuses a repo that is neither a name nor one owner/name pair", async () => {
    await expect(getRepository({ repo: "agntn/keys/main" })).rejects.toThrow(/exactly one slash/);
    await expect(getRepository({ repo: "agntn/" })).rejects.toThrow(/exactly one slash/);
  });

  it("names the missing owner when a bare repo carries none", async () => {
    await expect(getRepository({ repo: "keys" })).rejects.toThrow(
      'Missing owner for repository "keys"',
    );
    await expect(listRepositories({})).rejects.toThrow("Missing owner");
  });

  it("rejects rather than throws when a write resolves no target", async () => {
    await expect(createRelease({ repo: "keys", tag: "v1.0.0" })).rejects.toThrow("Missing owner");
  });
});

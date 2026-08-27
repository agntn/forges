import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticationError } from "../src/errors.ts";
import {
  createIssue,
  getAuthenticatedUser,
  getRepository,
  resetPinnedProviders,
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

  const resolveToken = vi.fn(() => {
    const token = credentialToken.current;
    return token === null ? null : { token, source: "env" as const };
  });

  const createProvider = vi.fn(
    (_platform: string, config?: { baseURL?: string; token?: string }) => {
      const anonymous = config?.token === "";
      const login = anonymous ? "anonymous" : localLogin.current;

      return {
        repos: {
          list: vi.fn(),
          get: vi.fn(async (owner: string, repo: string) => ({
            id: "1",
            name: repo,
            fullName: `${owner}/${repo}`,
            owner: { login },
            private: false,
            defaultBranch: "main",
          })),
        },
        issues: {
          create: vi.fn(async (_owner: string, _repo: string, input: { title: string }) => {
            if (anonymous) {
              anonymousWrites.current += 1;
            }
            return {
              id: "7",
              number: 7,
              title: input.title,
              state: "open",
              author: { login },
            };
          }),
        },
        users: {
          authenticated: vi.fn(async () => ({ id: "1", login })),
        },
      };
    },
  );

  return { localLogin, credentialToken, anonymousWrites, resolveToken, createProvider };
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
  mocks.resolveToken.mockClear();
  mocks.createProvider.mockClear();
  vi.stubEnv("FORGES_GITHUB_BASE_URL", undefined);
  vi.stubEnv("FORGES_GITEA_BASE_URL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configured provider", () => {
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

  it("falls back to anonymous public reads without making writes anonymous", async () => {
    mocks.credentialToken.current = null;

    const repository = await getRepository({ platform: "github", owner: "agntn", repo: "forges" });

    expect(repository.details.result.owner.login).toBe("anonymous");
    await expect(getAuthenticatedUser({ platform: "github" })).rejects.toThrow(AuthenticationError);
    await expect(createIssue(issueParams)).rejects.toThrow(AuthenticationError);
    expect(mocks.anonymousWrites.current).toBe(0);
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
});

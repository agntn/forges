import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  const createProvider = vi.fn((_platform: string, _config?: { baseURL?: string }) => {
    const login = localLogin.current;

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
        create: vi.fn(async (_owner: string, _repo: string, input: { title: string }) => ({
          id: "7",
          number: 7,
          title: input.title,
          state: "open",
          author: { login },
        })),
      },
      users: {
        authenticated: vi.fn(async () => ({ id: "1", login })),
      },
    };
  });

  return { localLogin, createProvider };
});

vi.mock("../src/index.ts", () => ({ createProvider: mocks.createProvider }));

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

  it("resolves separately for each platform and endpoint", async () => {
    await getRepository({ platform: "github", owner: "agntn", repo: "forges" });
    await getRepository({ platform: "gitea", owner: "agntn", repo: "forges" });
    vi.stubEnv("FORGES_GITEA_BASE_URL", "https://gitea.example.com/api/v1");
    await getRepository({ platform: "gitea", owner: "agntn", repo: "forges" });
    // An endpoint variable set but left empty is its own configuration, not the unset one.
    vi.stubEnv("FORGES_GITEA_BASE_URL", "");
    await getRepository({ platform: "gitea", owner: "agntn", repo: "forges" });

    expect(mocks.createProvider.mock.calls).toEqual([
      ["github", undefined],
      ["gitea", undefined],
      ["gitea", { baseURL: "https://gitea.example.com/api/v1" }],
      ["gitea", { baseURL: "" }],
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

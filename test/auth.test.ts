import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveToken } from "../src/auth.js";

// Mock child_process and fs
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedReadFileSync = vi.mocked(readFileSync);

describe("resolveToken", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    // Clear all token env vars
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITLAB_TOKEN;
    delete process.env.GL_TOKEN;
    delete process.env.GITLAB_PAT;
    delete process.env.GITEA_TOKEN;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  // --- Explicit token ---

  describe("explicit token", () => {
    it("returns explicit token when provided", () => {
      const result = resolveToken("github", { token: "my-token" });
      expect(result).toEqual({ token: "my-token", source: "explicit" });
    });

    it("returns explicit token even if empty string", () => {
      const result = resolveToken("github", { token: "" });
      expect(result).toEqual({ token: "", source: "explicit" });
    });

    it("skips env and CLI when explicit token is set", () => {
      process.env.GITHUB_TOKEN = "env-token";
      const result = resolveToken("github", { token: "explicit-token" });
      expect(result!.token).toBe("explicit-token");
      expect(result!.source).toBe("explicit");
    });
  });

  // --- Environment variables ---

  describe("env vars", () => {
    it("resolves GITHUB_TOKEN", () => {
      process.env.GITHUB_TOKEN = "ghp_abc123";
      const result = resolveToken("github");
      expect(result).toEqual({ token: "ghp_abc123", source: "env" });
    });

    it("resolves GH_TOKEN as fallback", () => {
      process.env.GH_TOKEN = "ghp_fallback";
      const result = resolveToken("github");
      expect(result).toEqual({ token: "ghp_fallback", source: "env" });
    });

    it("prefers GITHUB_TOKEN over GH_TOKEN", () => {
      process.env.GITHUB_TOKEN = "primary";
      process.env.GH_TOKEN = "fallback";
      const result = resolveToken("github");
      expect(result!.token).toBe("primary");
    });

    it("resolves GITLAB_TOKEN", () => {
      process.env.GITLAB_TOKEN = "glpat-123";
      const result = resolveToken("gitlab");
      expect(result).toEqual({ token: "glpat-123", source: "env" });
    });

    it("resolves GL_TOKEN as fallback for GitLab", () => {
      process.env.GL_TOKEN = "gl-fallback";
      const result = resolveToken("gitlab");
      expect(result!.token).toBe("gl-fallback");
    });

    it("resolves GITEA_TOKEN", () => {
      process.env.GITEA_TOKEN = "gitea-abc";
      const result = resolveToken("gitea");
      expect(result).toEqual({ token: "gitea-abc", source: "env" });
    });
  });

  // --- CLI tools ---

  describe("CLI tools", () => {
    it("runs gh auth token for GitHub", () => {
      mockedExecFileSync.mockReturnValueOnce("gho_clitoken\n");
      const result = resolveToken("github");
      expect(result).toEqual({ token: "gho_clitoken", source: "cli" });
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "gh",
        ["auth", "token", "--hostname", "github.com"],
        expect.objectContaining({ encoding: "utf-8", timeout: 5000 }),
      );
    });

    it("uses custom hostname from baseURL", () => {
      mockedExecFileSync.mockReturnValueOnce("gho_enterprise\n");
      const result = resolveToken("github", {
        baseURL: "https://github.corp.example.com/api/v3",
      });
      expect(result!.token).toBe("gho_enterprise");
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "gh",
        ["auth", "token", "--hostname", "github.corp.example.com"],
        expect.any(Object),
      );
    });

    it("returns null when gh CLI fails", () => {
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error("command not found: gh");
      });
      // No config file either
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const result = resolveToken("github");
      expect(result).toBeNull();
    });

    it("runs glab for GitLab", () => {
      mockedExecFileSync.mockReturnValueOnce("Token: glpat-fromcli\n");
      const result = resolveToken("gitlab");
      expect(result).toEqual({ token: "glpat-fromcli", source: "cli" });
    });

    it("skips tea CLI (relies on config files)", () => {
      // tea has no simple token command, should fall through to config
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const result = resolveToken("gitea");
      expect(result).toBeNull();
      // execSync should not be called for tea
      expect(mockedExecFileSync).not.toHaveBeenCalled();
    });
  });

  // --- Config files ---

  describe("config files", () => {
    it("reads gh hosts.yml for GitHub", () => {
      // CLI not available
      mockedExecFileSync.mockImplementation(() => {
        throw new Error("not found");
      });
      mockedReadFileSync.mockReturnValueOnce(
        "github.com:\n    oauth_token: gho_fromconfig\n    user: testuser\n",
      );
      const result = resolveToken("github");
      expect(result).toEqual({ token: "gho_fromconfig", source: "config" });
    });

    it("reads gh config for custom hostname", () => {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error("not found");
      });
      mockedReadFileSync.mockReturnValueOnce(
        "github.enterprise.com:\n    oauth_token: gho_enterprise\n    user: admin\n",
      );
      const result = resolveToken("github", {
        baseURL: "https://github.enterprise.com/api/v3",
      });
      expect(result!.token).toBe("gho_enterprise");
    });

    it("reads glab config for GitLab", () => {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error("not found");
      });
      mockedReadFileSync.mockReturnValueOnce("hosts:\n  gitlab.com:\n    token: glpat-fromfile\n");
      const result = resolveToken("gitlab");
      expect(result).toEqual({ token: "glpat-fromfile", source: "config" });
    });

    it("reads tea config for Gitea", () => {
      mockedReadFileSync.mockReturnValueOnce(
        "logins:\n  - name: codeberg.org\n    url: https://codeberg.org\n    token: tea-fromfile\n",
      );
      const result = resolveToken("gitea", {
        baseURL: "https://codeberg.org",
      });
      expect(result).toEqual({ token: "tea-fromfile", source: "config" });
    });

    it("returns null when no config file exists", () => {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error("not found");
      });
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const result = resolveToken("github");
      expect(result).toBeNull();
    });

    it("reads token only from matching host section", () => {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error("not found");
      });

      mockedReadFileSync.mockReturnValueOnce(
        "github.other.com:\n" +
          "  oauth_token: wrong-token\n" +
          "github.com:\n" +
          "  oauth_token: correct-token\n",
      );

      const result = resolveToken("github");
      expect(result).toEqual({ token: "correct-token", source: "config" });
    });
  });

  // --- Priority chain ---

  describe("priority", () => {
    it("explicit > env > cli > config", () => {
      process.env.GITHUB_TOKEN = "env-token";
      mockedExecFileSync.mockReturnValue("cli-token\n");

      // Explicit wins over all
      const r1 = resolveToken("github", { token: "explicit" });
      expect(r1!.source).toBe("explicit");

      // Env wins when no explicit
      const r2 = resolveToken("github");
      expect(r2!.source).toBe("env");

      // CLI wins when no env
      delete process.env.GITHUB_TOKEN;
      const r3 = resolveToken("github");
      expect(r3!.source).toBe("cli");
    });
  });

  // --- Default hostnames ---

  describe("hostname extraction", () => {
    it("defaults to github.com for GitHub", () => {
      mockedExecFileSync.mockReturnValueOnce("token\n");
      resolveToken("github");
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "gh",
        ["auth", "token", "--hostname", "github.com"],
        expect.any(Object),
      );
    });

    it("defaults to gitlab.com for GitLab", () => {
      mockedExecFileSync.mockReturnValueOnce("Token: token\n");
      resolveToken("gitlab");
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "glab",
        ["auth", "status", "-t", "-h", "gitlab.com"],
        expect.any(Object),
      );
    });

    it("extracts hostname from baseURL", () => {
      mockedExecFileSync.mockReturnValueOnce("token\n");
      resolveToken("github", { baseURL: "https://git.mycompany.com/api/v3" });
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "gh",
        ["auth", "token", "--hostname", "git.mycompany.com"],
        expect.any(Object),
      );
    });
  });
});

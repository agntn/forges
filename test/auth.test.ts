import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { resolveToken } from "../src/auth.ts";

const TOKEN_VARIABLES = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "GH_CONFIG_DIR",
  "GITLAB_TOKEN",
  "GL_TOKEN",
  "GITLAB_PAT",
  "GITLAB_ACCESS_TOKEN",
  "OAUTH_TOKEN",
  "GITEA_TOKEN",
  "BITBUCKET_TOKEN",
  "BITBUCKET_API_TOKEN",
  "BITBUCKET_EMAIL",
  "GITEE_TOKEN",
  "GITEE_ACCESS_TOKEN",
  "AZURE_DEVOPS_EXT_PAT",
  "AZURE_DEVOPS_EXT__DEFAULTS_ORGANIZATION",
  "AZURE_DEVOPS_EXT__CONFIG_DIR",
  "AZURE_DEVOPS_EXT_CONFIG_DIR",
  "CAFE_TOKEN",
  "CAFE_HOST",
  "CAFE_AUTH_FILE",
  "CAFE_CREDENTIAL_FILE",
];

let home: string;

/** Put a fake CLI on the PATH this test hands to the lookup. */
function cli(name: string, script: string): void {
  const path = join(home, "bin", name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
}

/** Write a file under the XDG config directory the lookup reads. */
function config(path: string, content: string): void {
  const file = join(home, "config", path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "forges-auth-"));
  mkdirSync(join(home, "bin"));
  for (const name of TOKEN_VARIABLES) vi.stubEnv(name, undefined);
  vi.stubEnv("PATH", join(home, "bin"));
  vi.stubEnv("XDG_CONFIG_HOME", join(home, "config"));
  vi.stubEnv("AZURE_CONFIG_DIR", join(home, "azure"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("resolveToken", () => {
  it("takes an explicit token, even an empty one", () => {
    vi.stubEnv("GH_TOKEN", "env-token");
    expect(resolveToken("github", { token: "" })).toEqual({
      token: "",
      source: "explicit",
      origin: "token",
    });
  });

  it("reads each platform's variables in order", () => {
    vi.stubEnv("GITHUB_TOKEN", "second");
    vi.stubEnv("GH_TOKEN", "first");
    vi.stubEnv("GL_TOKEN", "gitlab");
    vi.stubEnv("GITEA_TOKEN", "gitea");
    expect(resolveToken("github")).toEqual({ token: "first", source: "env", origin: "GH_TOKEN" });
    expect(resolveToken("gitlab")).toEqual({ token: "gitlab", source: "env", origin: "GL_TOKEN" });
    expect(resolveToken("gitea")).toEqual({ token: "gitea", source: "env", origin: "GITEA_TOKEN" });
  });

  it("asks gh for the host from baseURL", () => {
    cli("gh", 'echo "gho_$4"');
    expect(resolveToken("github", { baseURL: "https://ghe.example.com/api/v3" })).toEqual({
      token: "gho_ghe.example.com",
      source: "cli",
      origin: "gh",
    });
  });

  it("passes a login that starts with a dash as the value of --user", () => {
    cli("gh", 'echo "$5"');
    expect(resolveToken("github", { account: "-octocat" })?.token).toBe("--user=-octocat");
  });

  it("reads the active login's token from hosts.yml when gh is missing", () => {
    config(
      "gh/hosts.yml",
      [
        "github.com:",
        "    users:",
        "        octocat:",
        "            oauth_token: gho_octocat",
        "        hubot:",
        "            oauth_token: gho_hubot",
        "    git_protocol: https",
        "    oauth_token: gho_hubot",
        "    user: hubot",
        "",
      ].join("\n"),
    );
    expect(resolveToken("github")).toEqual({
      token: "gho_hubot",
      source: "config",
      origin: "gh hosts.yml",
    });
    expect(resolveToken("github", { account: "octocat" })?.token).toBe("gho_octocat");
  });

  it("keeps token variables away from glab, which would print one for any host", () => {
    vi.stubEnv("GITLAB_ACCESS_TOKEN", "glpat-from-env");
    cli("glab", 'echo "${GITLAB_ACCESS_TOKEN:-glpat-stored}"');
    expect(resolveToken("gitlab")).toEqual({
      token: "glpat-stored",
      source: "cli",
      origin: "glab",
    });
  });

  it("reads the tea login whose URL matches the host", () => {
    config(
      "tea/config.yml",
      [
        "logins:",
        "    - name: codeberg",
        "      url: https://codeberg.org",
        "      token: codeberg-token",
        "",
      ].join("\n"),
    );
    expect(resolveToken("gitea", { baseURL: "https://codeberg.org" })).toEqual({
      token: "codeberg-token",
      source: "config",
      origin: "tea config.yml",
    });
  });

  it("reads a Gitee token from GITEE_TOKEN before GITEE_ACCESS_TOKEN", () => {
    vi.stubEnv("GITEE_ACCESS_TOKEN", "access");
    expect(resolveToken("gitee")).toEqual({
      token: "access",
      source: "env",
      origin: "GITEE_ACCESS_TOKEN",
    });

    vi.stubEnv("GITEE_TOKEN", "primary");
    expect(resolveToken("gitee")).toMatchObject({ token: "primary", origin: "GITEE_TOKEN" });
  });

  it("reads a GitCafe token from CAFE_TOKEN, then from cafe's login helper", () => {
    cli("cafe", 'cat > /dev/null; printf "password=gct_cli\\n"');
    expect(resolveToken("gitcafe")).toEqual({ token: "gct_cli", source: "cli", origin: "cafe" });

    vi.stubEnv("CAFE_TOKEN", "gct_env");
    expect(resolveToken("gitcafe")).toEqual({
      token: "gct_env",
      source: "env",
      origin: "CAFE_TOKEN",
    });
  });

  it("reads an Azure DevOps PAT with the organization it belongs to", () => {
    vi.stubEnv("AZURE_DEVOPS_EXT_PAT", "pat");
    vi.stubEnv("AZURE_DEVOPS_EXT__DEFAULTS_ORGANIZATION", "https://dev.azure.com/acme");

    expect(resolveToken("azure-devops")).toEqual({
      token: "pat",
      source: "env",
      origin: "AZURE_DEVOPS_EXT_PAT",
      username: "",
      organization: "https://dev.azure.com/acme",
    });
    expect(
      resolveToken("azure-devops", { baseURL: "https://other.visualstudio.com" })?.organization,
    ).toBe("https://other.visualstudio.com");
  });

  it("reads a Bitbucket access token, or an API token with the email it logs in with", () => {
    vi.stubEnv("BITBUCKET_API_TOKEN", "ATATT-api");
    expect(resolveToken("bitbucket")).toBeNull();

    vi.stubEnv("BITBUCKET_EMAIL", "ada@example.com");
    expect(resolveToken("bitbucket")).toEqual({
      token: "ATATT-api",
      source: "env",
      origin: "BITBUCKET_API_TOKEN",
      username: "ada@example.com",
    });

    vi.stubEnv("BITBUCKET_TOKEN", "ATCTT-access");
    expect(resolveToken("bitbucket")).toEqual({
      token: "ATCTT-access",
      source: "env",
      origin: "BITBUCKET_TOKEN",
    });
    expect(resolveToken("bitbucket", { token: "explicit", username: "bob@example.com" })).toEqual({
      token: "explicit",
      source: "explicit",
      origin: "token",
      username: "bob@example.com",
    });
  });

  it("answers null when nothing holds a token, and for a named login off GitHub", () => {
    cli("glab", "echo glpat-active");
    expect(resolveToken("github")).toBeNull();
    expect(resolveToken("gitlab", { account: "octocat" })).toBeNull();
  });
});

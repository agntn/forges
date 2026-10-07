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
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("resolveToken", () => {
  it("takes an explicit token, even an empty one", () => {
    vi.stubEnv("GH_TOKEN", "env-token");
    expect(resolveToken("github", { token: "" })).toEqual({ token: "", source: "explicit" });
  });

  it("reads each platform's variables in order", () => {
    vi.stubEnv("GITHUB_TOKEN", "second");
    vi.stubEnv("GH_TOKEN", "first");
    vi.stubEnv("GL_TOKEN", "gitlab");
    vi.stubEnv("GITEA_TOKEN", "gitea");
    expect(resolveToken("github")).toEqual({ token: "first", source: "env" });
    expect(resolveToken("gitlab")).toEqual({ token: "gitlab", source: "env" });
    expect(resolveToken("gitea")).toEqual({ token: "gitea", source: "env" });
  });

  it("asks gh for the host from baseURL", () => {
    cli("gh", 'echo "gho_$4"');
    expect(resolveToken("github", { baseURL: "https://ghe.example.com/api/v3" })).toEqual({
      token: "gho_ghe.example.com",
      source: "cli",
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
    expect(resolveToken("github")).toEqual({ token: "gho_hubot", source: "config" });
    expect(resolveToken("github", { account: "octocat" })?.token).toBe("gho_octocat");
  });

  it("keeps token variables away from glab, which would print one for any host", () => {
    vi.stubEnv("GITLAB_ACCESS_TOKEN", "glpat-from-env");
    cli("glab", 'echo "${GITLAB_ACCESS_TOKEN:-glpat-stored}"');
    expect(resolveToken("gitlab")).toEqual({ token: "glpat-stored", source: "cli" });
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
    });
  });

  it("answers null when nothing holds a token, and for a named login off GitHub", () => {
    cli("glab", "echo glpat-active");
    expect(resolveToken("github")).toBeNull();
    expect(resolveToken("gitlab", { account: "octocat" })).toBeNull();
  });
});

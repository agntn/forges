/**
 * Auto-detect auth tokens from CLI tools and environment variables.
 *
 * Detection chain per platform:
 *   1. Explicit token (passed in config)
 *   2. Environment variables (GITHUB_TOKEN, GITLAB_TOKEN, etc.)
 *   3. CLI tools (gh, glab, tea)
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type Platform = "github" | "gitlab" | "gitea";

export interface AuthResult {
  token: string;
  source: "explicit" | "env" | "cli" | "config";
}

/**
 * Resolve a token for the given platform.
 * Returns null if no token can be found.
 */
export function resolveToken(
  platform: Platform,
  options?: { token?: string; baseURL?: string },
): AuthResult | null {
  // 1. Explicit token always wins (even empty string = intentional)
  if (options?.token !== undefined) {
    return { token: options.token, source: "explicit" };
  }

  const hostname = extractHostname(platform, options?.baseURL);

  // 2. Environment variables
  const envToken = resolveFromEnv(platform);
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  // 3. CLI tools
  const cliToken = resolveFromCli(platform, hostname);
  if (cliToken) {
    return { token: cliToken, source: "cli" };
  }

  // 4. Config files (fallback if CLI not installed but config exists)
  const configToken = resolveFromConfig(platform, hostname);
  if (configToken) {
    return { token: configToken, source: "config" };
  }

  return null;
}

function extractHostname(platform: Platform, baseURL?: string): string {
  if (baseURL) {
    try {
      return new URL(baseURL).hostname;
    } catch {
      // invalid URL, fall through to defaults
    }
  }

  switch (platform) {
    case "github":
      return "github.com";
    case "gitlab":
      return "gitlab.com";
    case "gitea":
      return "gitea.com";
  }
}

// --- Environment variables ---

const ENV_MAP: Record<Platform, string[]> = {
  github: ["GH_TOKEN", "GITHUB_TOKEN"],
  gitlab: ["GITLAB_TOKEN", "GL_TOKEN", "GITLAB_PAT"],
  gitea: ["GITEA_TOKEN"],
};

function resolveFromEnv(platform: Platform): string | null {
  for (const key of ENV_MAP[platform]) {
    const val = process.env[key];
    if (val) return val;
  }
  return null;
}

// --- CLI tools ---

function resolveFromCli(platform: Platform, hostname: string): string | null {
  switch (platform) {
    case "github":
      return ghAuthToken(hostname);
    case "gitlab":
      return glabAuthToken(hostname);
    case "gitea":
      return teaAuthToken(hostname);
  }
}

/**
 * Run `gh auth token` to get GitHub token.
 * Works for github.com and GitHub Enterprise (custom hostname).
 */
function ghAuthToken(hostname: string): string | null {
  try {
    const result = execFileSync("gh", ["auth", "token", "--hostname", hostname], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const token = result.trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Run `glab config get token` to read the stored GitLab token.
 * Outputs the raw token to stdout, designed for scripting.
 */
function glabAuthToken(hostname: string): string | null {
  try {
    const result = execFileSync(
      "glab",
      ["config", "get", "token", "--host", hostname],
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    );
    const token = result.trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * tea CLI doesn't have a simple "print token" command,
 * so we skip it and rely on config file parsing.
 */
function teaAuthToken(_hostname: string): string | null {
  return null;
}

// --- Config files ---

function resolveFromConfig(platform: Platform, hostname: string): string | null {
  switch (platform) {
    case "github":
      return readGhConfig(hostname);
    case "gitlab":
      return readGlabConfig(hostname);
    case "gitea":
      return readTeaConfig(hostname);
  }
}

/**
 * Read gh CLI config at ~/.config/gh/hosts.yml
 *
 * Format:
 *   github.com:
 *     oauth_token: gho_...
 *     user: username
 */
function readGhConfig(hostname: string): string | null {
  try {
    const configPath = join(ghConfigDir(), "hosts.yml");
    const content = readFileSync(configPath, "utf-8");
    const hostSection = getYamlMappingSection(content, hostname);
    if (!hostSection) return null;
    return extractYamlField(hostSection, "oauth_token");
  } catch {
    return null;
  }
}

/**
 * Read glab config at ~/.config/glab-cli/config.yml
 *
 * Format:
 *   hosts:
 *     gitlab.com:
 *       token: glpat-...
 */
function readGlabConfig(hostname: string): string | null {
  try {
    const configPath = join(configDir(), "glab-cli", "config.yml");
    const content = readFileSync(configPath, "utf-8");
    const hostsSection = getYamlMappingSection(content, "hosts");
    if (!hostsSection) return null;

    const hostSection = getYamlMappingSection(hostsSection, hostname);
    if (!hostSection) return null;

    return extractYamlField(hostSection, "token");
  } catch {
    return null;
  }
}

/**
 * Read tea config at ~/.config/tea/config.yml
 *
 * Format:
 *   logins:
 *     - name: gitea.com
 *       url: https://gitea.com
 *       token: ...
 */
function readTeaConfig(hostname: string): string | null {
  try {
    const configPath = join(configDir(), "tea", "config.yml");
    const content = readFileSync(configPath, "utf-8");
    const loginsSection = getYamlMappingSection(content, "logins");
    if (!loginsSection) return null;

    const entries = parseYamlListEntries(loginsSection);
    for (const entry of entries) {
      const name = entry.name;
      const url = entry.url;
      const token = entry.token;

      if (!token) continue;

      const urlHostname = url ? extractHostnameFromUrl(url) : null;
      if (name === hostname || urlHostname === hostname) {
        return token;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// --- Helpers ---

function configDir(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

function ghConfigDir(): string {
  return process.env.GH_CONFIG_DIR || join(configDir(), "gh");
}

function getYamlMappingSection(content: string, key: string): string | null {
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)([^:#][^:]*)\s*:\s*(?:#.*)?$/);
    if (!match) continue;

    const indent = match[1].length;
    const rawKey = stripQuotes(match[2].trim());
    if (rawKey !== key) continue;

    const sectionLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const childLine = lines[j];
      if (!childLine.trim()) {
        sectionLines.push(childLine);
        continue;
      }

      const childIndent = childLine.match(/^\s*/)?.[0].length ?? 0;
      if (childIndent <= indent) {
        break;
      }

      sectionLines.push(childLine);
    }

    return sectionLines.join("\n");
  }

  return null;
}

function extractYamlField(section: string, field: string): string | null {
  const lines = section.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.+?)\s*$/);
    if (!match) continue;

    if (match[1] !== field) continue;
    return parseYamlScalar(match[2]);
  }

  return null;
}

function parseYamlListEntries(section: string): Array<Record<string, string>> {
  const lines = section.split(/\r?\n/);
  const entries: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;

  for (const line of lines) {
    const itemMatch = line.match(/^\s*-\s*(.*)$/);
    if (itemMatch) {
      if (current) {
        entries.push(current);
      }
      current = {};

      if (itemMatch[1]) {
        const inlineField = itemMatch[1].match(/^([A-Za-z0-9_]+)\s*:\s*(.+?)\s*$/);
        if (inlineField) {
          current[inlineField[1]] = parseYamlScalar(inlineField[2]) ?? "";
        }
      }
      continue;
    }

    if (!current) continue;
    const fieldMatch = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.+?)\s*$/);
    if (!fieldMatch) continue;

    current[fieldMatch[1]] = parseYamlScalar(fieldMatch[2]) ?? "";
  }

  if (current) {
    entries.push(current);
  }

  return entries;
}

function parseYamlScalar(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  const withoutInlineComment = value.split(/\s+#/)[0]?.trim();
  return withoutInlineComment || null;
}

function stripQuotes(raw: string): string {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  return raw;
}

function extractHostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Token lookup, delegated to @agntn/credentials.
 *
 * Detection chain per platform:
 *   1. Explicit token (passed in config)
 *   2. Environment variables (GH_TOKEN, GITLAB_TOKEN, etc.)
 *   3. CLI tools (gh, glab)
 *   4. The CLI's config file, for a machine with the config but not the CLI
 */

import { resolve as resolveGitea } from "@agntn/credentials/gitea";
import { resolve as resolveGitHub } from "@agntn/credentials/github";
import { resolve as resolveGitLab } from "@agntn/credentials/gitlab";

export type Platform = "github" | "gitlab" | "gitea";

export interface AuthResult {
  token: string;
  source: "explicit" | "env" | "cli" | "config";
}

const resolvers = {
  github: resolveGitHub,
  gitlab: resolveGitLab,
  gitea: resolveGitea,
} satisfies Record<Platform, unknown>;

/**
 * Resolve a token for the given platform.
 * Returns null if no token can be found.
 */
export function resolveToken(
  platform: Platform,
  options?: { token?: string; baseURL?: string; account?: string },
): AuthResult | null {
  return resolvers[platform](options);
}

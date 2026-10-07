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
import { CredentialsError } from "@agntn/credentials";
import type { CloudflareCredential, CloudflareOptions } from "@agntn/credentials/cloudflare";
import { AuthenticationError } from "./errors.ts";

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

/** The Cloudflare token and account for `artifacts`, with the module loaded on the first call. */
export async function resolveCloudflareCredential(
  options: CloudflareOptions,
): Promise<CloudflareCredential> {
  const { resolve } = await import("@agntn/credentials/cloudflare");
  try {
    return await resolve(options);
  } catch (error) {
    if (!(error instanceof CredentialsError)) throw error;
    throw new AuthenticationError(
      `No Cloudflare credentials for artifacts: ${error.message}`,
      "artifacts",
      error,
    );
  }
}

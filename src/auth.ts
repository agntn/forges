/**
 * Token lookup, delegated to @agntn/credentials.
 *
 * Detection chain per platform:
 *   1. Explicit token (passed in config)
 *   2. Environment variables (GH_TOKEN, GITLAB_TOKEN, etc.)
 *   3. CLI tools (gh, glab, tea)
 *   4. The CLI's config file, for a machine with the config but not the CLI
 *
 * Bitbucket and Gitee have no CLI login to read, so their chains stop at the environment.
 * Azure DevOps reads `AZURE_DEVOPS_EXT_PAT`, then the PAT `az devops login` saved.
 */

import { resolve as resolveAzureDevOps } from "@agntn/credentials/azure-devops";
import { resolve as resolveBitbucket } from "@agntn/credentials/bitbucket";
import { resolve as resolveGitea } from "@agntn/credentials/gitea";
import { resolve as resolveGitCafe } from "@agntn/credentials/gitcafe";
import { resolve as resolveGitee } from "@agntn/credentials/gitee";
import { resolve as resolveGitHub } from "@agntn/credentials/github";
import { resolve as resolveGitLab } from "@agntn/credentials/gitlab";
import { CredentialsError } from "@agntn/credentials";
import type { CloudflareCredential, CloudflareOptions } from "@agntn/credentials/cloudflare";
import { AuthenticationError } from "./errors.ts";

export type Platform =
  | "github"
  | "gitlab"
  | "gitea"
  | "bitbucket"
  | "gitee"
  | "azure-devops"
  | "gitcafe";

export interface AuthResult {
  token: string;
  source: "explicit" | "env" | "cli" | "config";
  /** Where the token came from, such as `GL_TOKEN` or `gh hosts.yml`. */
  origin: string;
  /** Basic auth login of the token, such as `BITBUCKET_EMAIL`. */
  username?: string;
  /** Azure DevOps: the organization URL the token is for, such as `https://dev.azure.com/acme`. */
  organization?: string;
}

const resolvers = {
  github: resolveGitHub,
  gitlab: resolveGitLab,
  gitea: resolveGitea,
  bitbucket: resolveBitbucket,
  gitee: resolveGitee,
  "azure-devops": resolveAzureDevOps,
  gitcafe: resolveGitCafe,
} satisfies Record<Platform, unknown>;

/**
 * Resolve a token for the given platform.
 * Returns null if no token can be found.
 */
export function resolveToken(
  platform: Platform,
  options?: { token?: string; baseURL?: string; account?: string; username?: string },
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
    throw new AuthenticationError(`No Cloudflare credentials for artifacts: ${error.message}`, {
      platform: "artifacts",
      originalError: error,
    });
  }
}

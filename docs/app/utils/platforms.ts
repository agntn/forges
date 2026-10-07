/** One row per platform for the landing grid, the sidebar, the explorer and `::platform-facts`. Auth columns mirror `@agntn/credentials`. */
export interface PlatformInfo {
  /** The value passed to `createProvider()` and reported as `platform`. */
  readonly key: "github" | "gitlab" | "gitea";
  /** Page slug. GitBucket rides on the GitHub provider, Forgejo on Gitea. */
  readonly slug: string;
  readonly label: string;
  readonly icon: string;
  /** One sentence for the platform index. */
  readonly blurb: string;
  /** Default API base URL of the provider class. */
  readonly host: string;
  /** Environment variables `resolveToken()` reads, in order. */
  readonly envVars: readonly string[];
  /** CLI whose stored login is picked up when no env var is set. */
  readonly cli: string;
  /** Config file `resolveToken()` parses when the CLI is not installed, null when there is none. */
  readonly configFile: string | null;
  readonly authHeader: string;
  readonly anonymousReads: string;
  readonly threads: string;
  readonly codeSearch: string;
  readonly templates: string;
  readonly to: string;
}

export const PLATFORMS: readonly PlatformInfo[] = [
  {
    key: "github",
    slug: "github",
    label: "GitHub",
    icon: "i-simple-icons-github",
    blurb:
      "REST v3 for everything except review threads, which need GraphQL for their resolved flag. The reference the others are measured against.",
    host: "api.github.com",
    envVars: ["GH_TOKEN", "GITHUB_TOKEN"],
    cli: "gh auth token",
    configFile: "~/.config/gh/hosts.yml",
    authHeader: "Authorization: token",
    anonymousReads: "60 requests an hour per address",
    threads: "GraphQL, resolved and outdated flags",
    codeSearch: "global, owner and repository scope",
    templates: "repository and owner .github defaults",
    to: "/platforms/github",
  },
  {
    key: "gitlab",
    slug: "gitlab",
    label: "GitLab",
    icon: "i-simple-icons-gitlab",
    blurb:
      "API v4 with Private-Token auth, project ids resolved and cached for you, iid as the number, and a group fallback for owners that aren't users.",
    host: "gitlab.com/api/v4",
    envVars: ["GITLAB_TOKEN", "GL_TOKEN", "GITLAB_PAT"],
    cli: "glab config get token",
    configFile: "~/.config/glab-cli/config.yml",
    authHeader: "Private-Token",
    anonymousReads: "public projects only",
    threads: "REST discussions, no outdated flag",
    codeSearch: "authenticated; global and group need Premium",
    templates: "effective project templates, inherited source may be hidden",
    to: "/platforms/gitlab",
  },
  {
    key: "gitea",
    slug: "gitea",
    label: "Gitea",
    icon: "i-simple-icons-gitea",
    blurb:
      "API v1 with limit instead of per_page, empty strings and nulls where fields are missing, and Codeberg or any Forgejo through baseURL.",
    host: "gitea.com/api/v1",
    envVars: ["GITEA_TOKEN"],
    cli: "tea login (config file)",
    configFile: "~/.config/tea/config.yml",
    authHeader: "Authorization: token",
    anonymousReads: "public repositories",
    threads: "one thread per review comment",
    codeSearch: "unsupported, explicit error",
    templates: "repository scope only",
    to: "/platforms/gitea",
  },
  {
    key: "github",
    slug: "gitbucket",
    label: "GitBucket",
    icon: "i-lucide-server",
    blurb:
      "The GitHub provider pointed at a GitBucket /api/v3. What GitBucket doesn't serve fails with a sentence, not a 404.",
    host: "your host /api/v3",
    envVars: ["GH_TOKEN", "GITHUB_TOKEN"],
    cli: "none, pass the token",
    configFile: null,
    authHeader: "Authorization: token",
    anonymousReads: "depends on the instance",
    threads: "unsupported, REST v3 only",
    codeSearch: "unsupported without the endpoint",
    templates: "repository scope only",
    to: "/platforms/gitbucket",
  },
];

/** The three provider classes, one row each; GitBucket rides on the GitHub row. */
export const PROVIDER_PLATFORMS = PLATFORMS.filter((platform) => platform.slug === platform.key);

const BY_SLUG = new Map(PLATFORMS.map((platform) => [platform.slug, platform]));

export function platformInfo(slug: string): PlatformInfo | undefined {
  return BY_SLUG.get(slug);
}

export function platformLabel(slug: string): string {
  return platformInfo(slug)?.label ?? slug;
}

export function platformIcon(slug: string): string {
  return platformInfo(slug)?.icon ?? "i-lucide-folder-git-2";
}

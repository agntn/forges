/** One row per platform for the landing grid, the sidebar, the explorer and `::platform-facts`. Auth columns mirror `@agntn/credentials`. */
export interface PlatformInfo {
  /** The value passed to `createProvider()` and reported as `platform`. */
  readonly key:
    | "github"
    | "gitlab"
    | "gitea"
    | "bitbucket"
    | "gitee"
    | "azure-devops"
    | "gitcafe"
    | "pushin"
    | "tangled"
    | "artifacts";
  /** Page slug. GitBucket rides on the GitHub provider, Forgejo on Gitea. */
  readonly slug: string;
  readonly label: string;
  readonly icon: string;
  /** One sentence for the platform index. */
  readonly blurb: string;
  /** Default API base URL of the provider class. */
  readonly host: string;
  /** Environment variables the credential chain reads, in order. */
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
    key: "bitbucket",
    slug: "bitbucket",
    label: "Bitbucket",
    icon: "i-simple-icons-bitbucket",
    blurb:
      "Bitbucket Cloud API 2.0: pull requests and their threads read like anywhere else. Issues and releases aren't there to read.",
    host: "api.bitbucket.org/2.0",
    envVars: ["BITBUCKET_TOKEN", "BITBUCKET_API_TOKEN", "BITBUCKET_EMAIL"],
    cli: "none, there's no Bitbucket CLI login",
    configFile: null,
    authHeader: "Bearer or Basic",
    anonymousReads: "public repositories, until a 429 a handful of requests in",
    threads: "inline comments with their replies, resolvable",
    codeSearch: "unsupported, explicit error",
    templates: "none",
    to: "/platforms/bitbucket",
  },
  {
    key: "gitee",
    slug: "gitee",
    label: "Gitee",
    icon: "i-simple-icons-gitee",
    blurb:
      "Gitee API v5 on gitee.com. Issues keep their text keys, like ICK440, and pull requests keep their numbers.",
    host: "gitee.com/api/v5",
    envVars: ["GITEE_TOKEN", "GITEE_ACCESS_TOKEN"],
    cli: "none, there's no Gitee CLI login",
    configFile: null,
    authHeader: "Authorization: token",
    anonymousReads: "public repositories, until a plain-text 403 a few dozen requests in",
    threads: "unsupported, explicit error",
    codeSearch: "unsupported, explicit error",
    templates: "none",
    to: "/platforms/gitee",
  },
  {
    key: "azure-devops",
    slug: "azure-devops",
    label: "Azure DevOps",
    icon: "i-simple-icons-azuredevops",
    blurb:
      "REST 7.1 on dev.azure.com. A repository sits in a project in an organization, and work items stand in for issues.",
    host: "dev.azure.com",
    envVars: ["AZURE_DEVOPS_EXT_PAT"],
    cli: "az devops login (PAT file)",
    configFile: "~/.azure/azuredevops/personalAccessTokens",
    authHeader: "Authorization: Basic",
    anonymousReads: "public projects only, and there aren't many",
    threads: "threads on a file, resolved as fixed",
    codeSearch: "unsupported, explicit error",
    templates: "none",
    to: "/platforms/azure-devops",
  },
  {
    key: "gitcafe",
    slug: "gitcafe",
    label: "GitCafe",
    icon: "i-lucide-coffee",
    blurb:
      "REST on git.cafe/api. GitCafe stacks pull requests, and forges reads each one on its own, branches and all.",
    host: "git.cafe/api",
    envVars: ["CAFE_TOKEN"],
    cli: "cafe auth login",
    configFile: "~/.config/gitcafe/credentials.json",
    authHeader: "Authorization: Bearer",
    anonymousReads: "public repositories, everything but your own profile",
    threads: "inline comments, resolvable",
    codeSearch: "unsupported, explicit error",
    templates: "none",
    to: "/platforms/gitcafe",
  },
  {
    key: "pushin",
    slug: "pushin",
    label: "Pushin.eu",
    icon: "i-lucide-euro",
    blurb: "GitHub shaped REST on pushin.eu/api/v1. The clones live next door on git.pushin.eu.",
    host: "pushin.eu/api/v1",
    envVars: ["PUSHIN_TOKEN"],
    cli: "pun login",
    configFile: "~/.config/pun/hosts.json",
    authHeader: "Authorization: Bearer",
    anonymousReads: "public repositories, 90 requests a window",
    threads: "inline comments with their replies, resolvable",
    codeSearch: "unsupported, explicit error",
    templates: "none",
    to: "/platforms/pushin",
  },
  {
    key: "tangled",
    slug: "tangled",
    label: "Tangled",
    icon: "i-simple-icons-tangled",
    blurb:
      "A forge on atproto. Owners are handles, repositories are DIDs, and the git reads go through the public mirror.",
    host: "tangled.org",
    envVars: ["TANGLED_HANDLE", "TANGLED_PASSWORD"],
    cli: "none, set the handle and an app password",
    configFile: null,
    authHeader: "Authorization: Bearer",
    anonymousReads: "public repositories, no token in sight",
    threads: "none, review comments ride on the pull request",
    codeSearch: "unsupported, explicit error",
    templates: "none",
    to: "/platforms/tangled",
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
  {
    key: "artifacts",
    slug: "artifacts",
    label: "Artifacts",
    icon: "i-simple-icons-cloudflare",
    blurb:
      "Git storage behind the Cloudflare API. Repos, files and history read like on any forge, and the forge part is a 501.",
    host: "api.cloudflare.com/client/v4",
    envVars: ["CLOUDFLARE_API_TOKEN", "AGNTN_CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"],
    cli: "cf auth login session",
    configFile: null,
    authHeader: "Authorization: Bearer",
    anonymousReads: "none, every read needs a token",
    threads: "none, no pull requests to hang them on",
    codeSearch: "unsupported, explicit error",
    templates: "none",
    to: "/platforms/artifacts",
  },
];

/** One row per provider class; GitBucket rides on the GitHub row. */
export const PROVIDER_PLATFORMS = PLATFORMS.filter((platform) => platform.slug === platform.key);

/** What the docs worker reads; the rest want a token or an account it doesn't hold. */
export const EXPLORER_PLATFORMS = PROVIDER_PLATFORMS.filter(
  (platform) =>
    !["artifacts", "bitbucket", "gitee", "azure-devops", "gitcafe", "pushin", "tangled"].includes(
      platform.key,
    ),
);

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

# @agntn/forges

[![npm version](https://npmx.dev/api/registry/badge/version/@agntn/forges)](https://npmx.dev/package/@agntn/forges)
[![npm downloads](https://npmx.dev/api/registry/badge/downloads/@agntn/forges)](https://npmx.dev/package/@agntn/forges)
[![license](https://npmx.dev/api/registry/badge/license/@agntn/forges)](https://npmx.dev/package/@agntn/forges)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/forges)

One API. Every forge. GitHub, GitLab, Gitea and GitBucket behind one TypeScript provider, with repositories, issues, pull requests, review threads, commits and CI in the same shape and the token found for you.

Every Git platform does the same things and none of them agree on how. GitLab says merge request, GitHub says pull request. GitLab paginates with `x-next-page`, GitHub with `Link`, Gitea wants `limit` where everyone else wants `per_page`. GitLab numbers issues twice and the one you want is the `iid`. Keep one client per platform in an agent and you have four ways to misread a number.

Docs and the live explorer: [forges.agntn.dev](https://forges.agntn.dev). The source lives in [`docs/`](./docs), run `pnpm docs` after `pnpm build` for a local copy.

## Install

```bash
pnpm add @agntn/forges
```

## First call

If `gh` is installed and logged in, this works with no config at all:

```typescript
import { createProvider } from "@agntn/forges";

// Token from GITHUB_TOKEN, then from `gh auth token`
const github = createProvider("github");

const repo = await github.repos.get("nitrojs", "nitro");
console.log(repo.fullName, repo.defaultBranch, repo.isFork);

const { items, hasNextPage } = await github.pullRequests.list("nitrojs", "nitro", {
  state: "open",
});
```

Same for GitLab with `glab`, and Gitea with `tea` or `GITEA_TOKEN`. The chain is explicit token, then env, then the CLI, then the CLI's config file, and it stops at the first hit. When nothing matches you get an `AuthenticationError` naming the env var to set, never a silent anonymous call. An empty string is a real token and means anonymous on purpose. The whole thing: [Authentication](https://forges.agntn.dev/guide/auth).

```typescript
const gitlab = createProvider("gitlab", {
  token: "glpat-…",
  baseURL: "https://gitlab.example.com",
});
const codeberg = createProvider("gitea", { baseURL: "https://codeberg.org" });
const gitbucket = createProvider("github", {
  token: "…",
  baseURL: "https://gitbucket.example.com/api/v3",
});
```

## Platforms

| Platform                                                             | Provider             | Auth header            | Threads                          | Code search                        |
| -------------------------------------------------------------------- | -------------------- | ---------------------- | -------------------------------- | ---------------------------------- |
| [GitHub](https://forges.agntn.dev/platforms/github)                  | `github`             | `Authorization: token` | GraphQL, real flags              | global, owner, repository          |
| [GitLab](https://forges.agntn.dev/platforms/gitlab)                  | `gitlab`             | `Private-Token`        | REST discussions, token required | token required, Premium for global |
| [Gitea, Forgejo, Codeberg](https://forges.agntn.dev/platforms/gitea) | `gitea` + `baseURL`  | `Authorization: token` | one thread per review comment    | none                               |
| [GitBucket](https://forges.agntn.dev/platforms/gitbucket)            | `github` + `baseURL` | `Authorization: token` | none                             | none                               |

GitBucket speaks the GitHub API, so it is the GitHub provider with a `baseURL` and nothing more. Forgejo is a Gitea fork with the same API, same deal.

## Nine resources

```typescript
forge.repos; //                  list(owner), get(owner, repo)
forge.contributionTemplates; //  list(owner, repo, kind), get(owner, repo, kind, key)
forge.code; //                   search(query, { owner?, repo? })
forge.ciRuns; //                 list(owner, repo, { branch? })
forge.commits; //                list(owner, repo, { ref?, path?, since?, until? }), get(owner, repo, sha)
forge.issues; //                 list, search, get, create, listComments, getComment
forge.pullRequests; //           list, listFiles, listChecks, search, get, create, listComments, getComment
forge.users; //                  get(username), authenticated()
forge.threads; //                list, get, reply, resolve, unresolve
```

Every list is a `PageResult<T>`: `items`, `hasNextPage`, `nextPage`, and `totalCount` when the platform bothers to count. Searches add `incomplete`, true when the answer is known to be partial. IDs are always strings, even when the API sends a number. Counts a platform withholds come back as `null`, never as zero.

A few things worth knowing before the docs: GitHub review threads go through GraphQL so `isResolved` and `isOutdated` are real, GitLab and Gitea have no outdated flag so it is always `false` there, and Gitea has no parent id on review comments so every one is its own thread. Pull request search returns less than `get`, call `get` for branches and mergeability. Commit reads carry changed files but never patches. The per resource pages: [Repositories](https://forges.agntn.dev/guide/repositories), [Issues](https://forges.agntn.dev/guide/issues), [Pull requests](https://forges.agntn.dev/guide/pull-requests), [Review threads](https://forges.agntn.dev/guide/threads), [Commits and CI](https://forges.agntn.dev/guide/commits), [Contribution templates](https://forges.agntn.dev/guide/templates), [Code search](https://forges.agntn.dev/guide/code-search).

## Agents

Thirty tools, three surfaces. The MCP server, the Pi extension and the OMP extension call the same executors, so a fix lands once.

```bash
forges mcp
pi install npm:@agntn/forges
```

```json
{
  "mcpServers": {
    "forges": { "command": "npx", "args": ["-y", "@agntn/forges", "mcp"] }
  }
}
```

Reads fall back to anonymous access when no credential exists. Five tools write, `forges_issues_create`, `forges_pull_requests_create`, `forges_threads_reply`, `forges_threads_resolve` and `forges_threads_unresolve`, and they say so in their annotations so a client can gate them. `forges_users_authenticated` names the account a write would go out as, check it before letting a model write anything. Lists drop bodies and name the tool that reads one in full, because one page of a busy repository with bodies is enough to push the conversation out of the context.

A self hosted endpoint is `FORGES_GITHUB_BASE_URL`, `FORGES_GITLAB_BASE_URL` or `FORGES_GITEA_BASE_URL` in the agent's process environment. Never a tool argument, and a failure never repeats the endpoint, so the host stays out of the model's context. The rest: [Agents](https://forges.agntn.dev/guide/agents).

## Errors

```typescript
import { NotFoundError, AuthenticationError, PermissionError, RateLimitError } from "@agntn/forges";

try {
  await forge.repos.get("owner", "nope");
} catch (error) {
  if (error instanceof NotFoundError) {
    // 404 on any platform
  }
  if (error instanceof RateLimitError) {
    console.log(error.retryAfter); // seconds, when the platform said
  }
  // every one has error.status, error.platform and error.originalError
}
```

A 404 from GitHub and a 404 from GitLab are the same `NotFoundError`. 401 is `AuthenticationError`, a 403 that is not a rate limit is `PermissionError`, 429 is `RateLimitError`. Anything a provider simply does not have, like code search on Gitea, is a `ForgesError` with status 501 and a sentence saying so.

## Caching

Stable reads go through an LRU on [unstorage](https://unstorage.unjs.io), five minutes and five hundred entries by default, scoped to the base URL and a hash of the token. Item reads of repositories, issues, pull requests, comments and users skip it, because a stale answer there is worse than no cache.

```typescript
const github = createProvider("github", {
  cache: { ttl: 60_000, enabled: false },
});
```

## One provider at a time

```typescript
import { Provider } from "@agntn/forges";
import { GitHubProvider } from "@agntn/forges/github";
import { GitLabProvider } from "@agntn/forges/gitlab";
import { GiteaProvider } from "@agntn/forges/gitea";
import type { Repository } from "@agntn/forges/types";

const gitea = new GiteaProvider({ token: process.env.GITEA_TOKEN });
console.log(gitea instanceof Provider); // true
```

`Provider` is the abstract base with the nine resource accessors, also on `@agntn/forges/provider`. Your own platform is one class extending it plus the typed mappers, and everything you skip fails with an explicit 501 instead of pretending. [Custom providers](https://forges.agntn.dev/guide/custom) has the skeleton.

## What this does not do

Repository content, trees, branches, tags, webhooks and admin. On purpose. The scope is the review workflow: what is proposed, what was said about it, and whether it passed.

## Development

```bash
pnpm install
pnpm test        # vitest in watch mode
pnpm run build   # obuild
pnpm docs        # the site, after pnpm build
```

## License

[MIT](./LICENSE)

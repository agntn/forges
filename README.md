# forges

[![npm version](https://img.shields.io/npm/v/%40agntn%2Fforges?style=flat&colorA=130f40&colorB=474787)](https://npmjs.com/package/@agntn/forges)
[![npm downloads](https://img.shields.io/npm/dm/%40agntn%2Fforges?style=flat&colorA=130f40&colorB=474787)](https://npm.chart.dev/@agntn/forges)
[![license](https://img.shields.io/github/license/agntn/forges?style=flat&colorA=130f40&colorB=474787)](https://github.com/agntn/forges/blob/main/LICENSE)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/forges)

One API for GitHub, GitLab, Gitea, and GitBucket. Write your code once, swap the provider string, done.

If you've ever had to maintain separate API integrations for different git platforms, you know the pain. They all do the same things but none of them agree on how. GitLab calls them "merge requests", GitHub calls them "pull requests". GitLab paginates with `x-next-page` headers, GitHub uses `Link` headers. GitLab authenticates with `Private-Token`, GitHub with `Authorization: token`. And so on.

`@agntn/forges` normalizes all of that behind one abstract provider API.

## Install

```bash
pnpm add @agntn/forges
# or: npm install @agntn/forges
```

## Usage

If you have `gh` (GitHub CLI) installed and logged in, this just works:

```typescript
import { createProvider } from "@agntn/forges";

// No token needed - picked up from `gh auth token`
const github = createProvider("github");

const { items: repos } = await github.repos.list("unjs");
const repo = await github.repos.get("agntn", "forges");
console.log(repo.fullName, repo.defaultBranch);
```

Same for GitLab with `glab`, and Gitea with `tea` or env vars.

You can always pass a token explicitly:

```typescript
const github = createProvider("github", {
  token: process.env.GITHUB_TOKEN,
});

const gitlab = createProvider("gitlab", {
  token: "glpat-...",
  baseURL: "https://gitlab.example.com",
});
```

The detection chain is: explicit token > env vars (`GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITEA_TOKEN`) > CLI tools (`gh`, `glab`) > CLI config files. First match wins.

## Providers

### GitHub (+ GitBucket)

GitBucket implements the GitHub API, so the same provider handles both. Just change the `baseURL`:

```typescript
// GitHub - token auto-detected from gh CLI
const gh = createProvider("github");

// GitBucket - same provider, different URL
const gb = createProvider("github", {
  token: "...",
  baseURL: "https://my-gitbucket.example.com/api/v3",
});
```

### GitLab

Uses `Private-Token` auth and the v4 API internally. You don't need to care about that.

```typescript
// Token auto-detected from glab CLI or GITLAB_TOKEN env var
const gl = createProvider("gitlab");

// Or explicit
const gl2 = createProvider("gitlab", {
  token: "glpat-...",
  baseURL: "https://gitlab.example.com",
});
```

### Gitea / Forgejo

Forgejo is a Gitea fork with the same API, so both work.

```typescript
const gt = createProvider("gitea", {
  baseURL: "https://codeberg.org", // or any Gitea/Forgejo instance
});
```

## Agent tools

The same twenty-four tools - repositories, CI runs, issues, pull requests and their checks, users, authentication reload, discussion comments, and review threads - are exposed over MCP and through the Pi and OMP extensions. Read tools use the normal token detection chain, then fall back to anonymous access when no credential exists. Writes, `forges_users_authenticated`, and `forges_auth_reload` still require a credential. For a trusted self-hosted endpoint, set the matching local environment variable to the full API base URL:

| Platform           | Environment variable     |
| ------------------ | ------------------------ |
| GitHub / GitBucket | `FORGES_GITHUB_BASE_URL` |
| GitLab             | `FORGES_GITLAB_BASE_URL` |
| Gitea / Forgejo    | `FORGES_GITEA_BASE_URL`  |

These values come from the agent process environment and never become tool arguments a model can set. Tokens stay local too, so a model cannot redirect an operation to another host. `forges_repos_get` includes fork state, its immediate parent, and the viewer's highest repository role. A `null` `viewerPermission` means the platform omitted access metadata, not that the viewer has no access.

### MCP server

```bash
forges mcp
```

Speaks MCP over stdio. Point a client at it:

```json
{
  "mcpServers": {
    "forges": { "command": "npx", "args": ["-y", "@agntn/forges", "mcp"] }
  }
}
```

An MCP client sees the text a tool returns and nothing else, so the text carries the whole answer as JSON. Issue and pull-request lists and searches drop bodies outright and name the tool that reads one in full, because one page of a busy repository is otherwise large enough to crowd out the conversation that asked for it. Pull-request search also leaves revision details to `forges_pull_requests_get`; GitHub and Gitea search responses do not carry them, and extra detail requests would make one search page unnecessarily expensive. `forges_threads_list` bounds each comment instead - twelve lines, four thousand characters - but keeps every comment of every thread on the page, so ask it for a small `perPage` on a heavily reviewed pull request. `forges_issues_comments` and `forges_pull_requests_comments` carry the same per-comment bound, and their `_get` variants read a single comment whole.

A failure names the status and, on a rate limit, the retry window; it never repeats the endpoint the request went to, so a self-hosted `FORGES_*_BASE_URL` stays out of the model's context even when the platform answers with an error.

Five tools write to Git hosts: `forges_issues_create`, `forges_pull_requests_create`, `forges_threads_reply`, `forges_threads_resolve` and `forges_threads_unresolve`. They are advertised as writes so a client can gate them, and `forges_users_authenticated` names the account they would write as. The credential stays pinned per platform and endpoint until `forges_auth_reload` explicitly replaces it and returns the newly authenticated profile. Reload is gated as a mutation because it changes local server state, but it writes nothing to the Git host. Anonymous read providers stay separate and cannot be reused for a write. A failed operation comes back as a tool error rather than a transport failure: an unknown repository, a rejected token, an exhausted rate limit.

`createMcpServer()` is exported from `@agntn/forges/mcp` for hosts that bring their own transport.

### Pi and OMP extensions

```bash
pi install npm:@agntn/forges
```

The extensions add the details the harnesses render; MCP drops them and keeps the text. All three surfaces call the executors in `src/tool-operations.ts`, so they answer identically.

## API

Every provider gives you six resources with the same method shapes. Thread semantics still follow the platform: GitHub and GitLab return real multi-comment conversations, while Gitea has no parent id on review comments, so each one comes back as its own single-comment thread.

**repos** - `list(owner, opts?)`, `get(owner, repo)`

**ciRuns** - `list(owner, repo, opts?)`

**issues** - `list(owner, repo, opts?)`, `search(owner, repo, query, opts?)`, `get(owner, repo, number)`, `create(owner, repo, input)`, `listComments(owner, repo, number, opts?)`

**pullRequests** - `list(owner, repo, opts?)`, `listChecks(owner, repo, number, opts?)`, `search(owner, repo, query, opts?)`, `get(owner, repo, number)`, `create(owner, repo, input)`, `listComments(owner, repo, number, opts?)`

**users** - `get(username)`, `authenticated()`

**threads** - `list(owner, repo, number, opts?)`, `get(owner, repo, number, threadId)`, `reply(owner, repo, number, threadId, input)`, `resolve(owner, repo, number, threadId)`, `unresolve(owner, repo, number, threadId)`

CI-run lists accept `ListCiRunsOptions`: `page`, `perPage`, and an optional `branch` filter. They normalize GitHub Actions runs, GitLab pipelines, and Gitea Actions runs to branch, revision SHA, lifecycle status, terminal conclusion, and URL. Pull-request check lists accept `ListPullRequestChecksOptions`: `page` and `perPage`. They read GitHub check runs for the head SHA, GitLab merge-request pipelines for the current head SHA, and Gitea commit statuses, normalized to name, lifecycle status, terminal conclusion, and URL. Issue and pull request lists accept `ListOptions`: `page`, `perPage`, and `state` (`'open' | 'closed' | 'all'`); repository lists use its pagination fields. Lists return `PageResult<T>` with `items`, `hasNextPage`, `nextPage`, and an optional `totalCount`. Issue and pull-request searches accept the same options and return those fields plus `incomplete`, which is true when the result is known to be partial. Queries keep the selected platform's syntax: GitHub qualifiers work on GitHub, while GitLab and Gitea treat them as text. Pull-request search returns `PullRequestSearchItem`; call `get` for branches, revisions, and mergeability.

`listComments` reads the discussion under an issue or pull request oldest first and accepts `ListCommentOptions`: `page` and `perPage`. On GitHub and Gitea the two variants read the same endpoint, because both platforms index pull requests as issues. GitLab notes are fetched with an explicit ascending sort, and both its system notes about label and state churn and its inline DiffNotes, which belong to the thread surface, are dropped, so a short page whose `hasNextPage` is true means keep paging. Gitea answers with the whole discussion in one response, so the requested page is cut locally.

User lookups return the whole profile: bio, company, location, website, follower counts, the account creation date and the profile URL. On GitLab that takes two requests, because the username search returns only a bare stub; `get` resolves the id from it and then reads the full profile. Anything a platform does not expose comes back as an empty string or a zero count, like `company` on Gitea.

Thread list operations accept `ListThreadOptions`: `page`, `perPage`, and `state` (`'unresolved' | 'resolved' | 'all'`). GitHub review-thread list/get/resolve uses GraphQL so `isResolved` and `isOutdated` stay accurate; replies still go through the REST comment-reply endpoint. GitLab and Gitea have no equivalent flag, so `isOutdated` is always `false` there. GitBucket serves only REST v3, so thread operations against it fail with an explicit unsupported-endpoint error rather than a bare 404.

## Caching

Stable GET resources are cached automatically using [unstorage](https://unstorage.unjs.io) with an LRU driver (5 min TTL, 500 entries). Issue, pull request, discussion comment, and user item reads skip the cache because their state can change between verification calls. Entries are scoped to the client's base URL and a hash of its token, so two providers in one process, with different hosts or tokens, never read each other's responses. Works out of the box, but you can tweak it:

```typescript
const github = createProvider("github", {
  cache: {
    ttl: 60_000, // 1 minute
    enabled: false, // or turn it off entirely
  },
});
```

## Errors

All providers throw the same error types:

```typescript
import { NotFoundError, AuthenticationError, RateLimitError } from "@agntn/forges";

try {
  await provider.repos.get("owner", "nope");
} catch (err) {
  if (err instanceof NotFoundError) {
    // 404
  }
  if (err instanceof RateLimitError) {
    // 429, check err.retryAfter
  }
  // All errors have err.status, err.platform, err.originalError
}
```

A 404 from GitHub and a 404 from GitLab both become `NotFoundError`. Same for 401 (`AuthenticationError`) and 429 (`RateLimitError`). Everything else is a generic `ForgesError`.

## Sub-path exports

If you only need one provider, import it directly. Better for tree-shaking.

```typescript
import { Provider } from "@agntn/forges";
import { GitHubProvider } from "@agntn/forges/github";
import { GitLabProvider } from "@agntn/forges/gitlab";
import { GiteaProvider } from "@agntn/forges/gitea";
import type { Repository } from "@agntn/forges/types";

const gitea = new GiteaProvider({ token: process.env.GITEA_TOKEN });

console.log(gitea instanceof Provider); // true
```

`Provider` is the abstract base class for every implementation. It owns the six resource accessors, while concrete classes implement the typed mappers and platform-specific API operations. Custom providers that do not implement CI runs or pull-request checks get an explicit unsupported-operation error.

The runtime base class is also available from `@agntn/forges/provider`. The
`@agntn/forges/types` subpath contains only TypeScript models and resource interfaces.

## Utilities

A few lower-level pieces are exported if you need them:

```typescript
import { resolveToken } from "@agntn/forges";
import { fetchAllPages, paginate } from "@agntn/forges";
```

`resolveToken('github')` runs the same auth detection chain without creating a provider. Useful for checking if credentials exist.

`fetchAllPages(fetcher, url)` collects every page into a single array. `paginate(fetcher, url)` is the async generator version if you want to process pages as they come.

## What this doesn't do

This is an MVP. It covers repos, CI runs, issues, PRs, users, and review threads. It does not handle:

- File/content operations (reading files, commits, trees)
- Webhooks
- Branch/tag management
- GraphQL outside GitHub review threads
- Admin operations

These might come later. For now the scope is intentionally small.

## Development

```bash
pnpm install
pnpm test        # vitest in watch mode
pnpm run build   # obuild
```

## License

[MIT](./LICENSE)

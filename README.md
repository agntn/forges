# gixa

[![npm version](https://img.shields.io/npm/v/gixa?style=flat&colorA=130f40&colorB=474787)](https://npmjs.com/package/gixa)
[![npm downloads](https://img.shields.io/npm/dm/gixa?style=flat&colorA=130f40&colorB=474787)](https://npm.chart.dev/gixa)
[![license](https://img.shields.io/github/license/oritwoen/gixa?style=flat&colorA=130f40&colorB=474787)](https://github.com/oritwoen/gixa/blob/main/LICENSE)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/oritwoen/gixa)

One API for GitHub, GitLab, Gitea, and GitBucket. Write your code once, swap the provider string, done.

If you've ever had to maintain separate API integrations for different git platforms, you know the pain. They all do the same things but none of them agree on how. GitLab calls them "merge requests", GitHub calls them "pull requests". GitLab paginates with `x-next-page` headers, GitHub uses `Link` headers. GitLab authenticates with `Private-Token`, GitHub with `Authorization: token`. And so on.

`gixa` normalizes all of that behind a single interface.

## Install

```bash
npm install gixa
```

## Usage

If you have `gh` (GitHub CLI) installed and logged in, this just works:

```typescript
import { createProvider } from 'gixa'

// No token needed - picked up from `gh auth token`
const github = createProvider('github')

const { items: repos } = await github.repos.list('unjs')
const repo = await github.repos.get('unjs', 'gixa')
console.log(repo.fullName, repo.defaultBranch)
```

Same for GitLab with `glab`, and Gitea with `tea` or env vars.

You can always pass a token explicitly:

```typescript
const github = createProvider('github', {
  token: process.env.GITHUB_TOKEN,
})

const gitlab = createProvider('gitlab', {
  token: 'glpat-...',
  baseURL: 'https://gitlab.example.com',
})
```

The detection chain is: explicit token > env vars (`GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITEA_TOKEN`) > CLI tools (`gh`, `glab`) > CLI config files. First match wins.


## Providers

### GitHub (+ GitBucket)

GitBucket implements the GitHub API, so the same provider handles both. Just change the `baseURL`:

```typescript
// GitHub - token auto-detected from gh CLI
const gh = createProvider('github')

// GitBucket - same provider, different URL
const gb = createProvider('github', {
  token: '...',
  baseURL: 'https://my-gitbucket.example.com/api/v3',
})
```

### GitLab

Uses `Private-Token` auth and the v4 API internally. You don't need to care about that.

```typescript
// Token auto-detected from glab CLI or GITLAB_TOKEN env var
const gl = createProvider('gitlab')

// Or explicit
const gl2 = createProvider('gitlab', {
  token: 'glpat-...',
  baseURL: 'https://gitlab.example.com',
})
```

### Gitea / Forgejo

Forgejo is a Gitea fork with the same API, so both work.

```typescript
const gt = createProvider('gitea', {
  baseURL: 'https://codeberg.org', // or any Gitea/Forgejo instance
})
```

## API

Every provider gives you four resources. They all work the same way across platforms.

**repos** - `list(owner)`, `get(owner, repo)`

**issues** - `list(owner, repo, opts?)`, `get(owner, repo, number)`, `create(owner, repo, input)`

**pullRequests** - `list(owner, repo, opts?)`, `get(owner, repo, number)`, `create(owner, repo, input)`

**users** - `get(username)`, `authenticated()`

List operations return `PageResult<T>` with `items`, `hasNextPage`, `nextPage`, and an optional `totalCount`.

## Caching

GET requests are cached automatically using [unstorage](https://unstorage.unjs.io) with an LRU driver (5 min TTL, 500 entries). No configuration needed — it just keeps repeated reads fast.

## Errors

All providers throw the same error types:

```typescript
import { NotFoundError, AuthenticationError, RateLimitError } from 'gixa'

try {
  await provider.repos.get('owner', 'nope')
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

A 404 from GitHub and a 404 from GitLab both become `NotFoundError`. Same for 401 (`AuthenticationError`) and 429 (`RateLimitError`). Everything else is a generic `GixaError`.

## Sub-path exports

If you only need one provider, import it directly. Better for tree-shaking.

```typescript
import { GitHubProvider } from 'gixa/github'
import { GitLabProvider } from 'gixa/gitlab'
import { createGiteaProvider } from 'gixa/gitea'
import type { Provider, Repository } from 'gixa/types'
```

## What this doesn't do

This is an MVP. It covers repos, issues, PRs, and users. It does not handle:

- File/content operations (reading files, commits, trees)
- Webhooks
- Branch/tag management
- GraphQL (REST only)
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

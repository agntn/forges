# @agntn/forges

[![npm version](https://npmx.dev/api/registry/badge/version/@agntn/forges)](https://npmx.dev/package/@agntn/forges)
[![npm downloads](https://npmx.dev/api/registry/badge/downloads/@agntn/forges)](https://npmx.dev/package/@agntn/forges)
[![license](https://npmx.dev/api/registry/badge/license/@agntn/forges)](https://npmx.dev/package/@agntn/forges)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/forges)

⚒️ Four forges, ten resources, 45 agent tools. You ask for a pull request, you get a pull request.

## Why?

Every Git host does the same job and none of them agree on the words. Pull request or merge request, `per_page` or `limit`, `Link` or `x-next-page`, and GitLab's URL number is the `iid` not the `id`. An agent with four clients will pick the wrong number. Talk to one `Provider` and let it remember which header is which.

Docs, and an explorer that runs the same calls: [forges.agntn.dev](https://forges.agntn.dev).

## ✨ Features

- 🧩 **Four forges, one `Provider`.** GitHub, GitLab, Gitea and GitBucket. Same `repos.get`, same `Issue`, same `PullRequest`.
- 🔑 **It finds the token.** Explicit value, then env, then `gh` or `glab`, then the CLI config file. First hit wins.
- 📦 **Loads one platform.** `createProvider("github")` is async. It imports GitHub and leaves GitLab on disk.
- 🆔 **IDs are strings.** Even when the API sent a number. A count the forge withholds is missing, not `0`.
- 🫥 **Empty string is guest.** `{ token: "" }` is anonymous on purpose. Leave `token` out and you get `AuthenticationError`, not a quiet guest session.
- 🤖 **45 tools, three surfaces.** MCP, Pi and OMP share the executors. Eight tools write to the host.
- 🚫 **Missing is 501.** Code search on Gitea is not an empty page. You get a `ForgesError` with status 501.
- 🧭 **GitBucket is GitHub plus `baseURL`.** Forgejo and Codeberg are Gitea plus `baseURL`. Same class, different host.

## 📦 Install

```bash
pnpm add @agntn/forges
```

Node.js 22 or newer.

## 🚀 First call

```ts
import { createProvider } from "@agntn/forges";

const codeberg = await createProvider("gitea", {
  token: "",
  baseURL: "https://codeberg.org",
});

const repo = await codeberg.repos.get("forgejo", "forgejo");
console.log(repo.fullName, repo.description, repo.defaultBranch);
```

```
forgejo/forgejo Beyond coding. We forge. forgejo
```

They said it, not me. No key. You still pass the host. Empty string is guest.

Logged into `gh`? Drop the config object.

```ts
const github = await createProvider("github");
const hello = await github.repos.get("octocat", "Hello-World");
console.log(hello.fullName, hello.description, hello.defaultBranch);
```

```
octocat/Hello-World My first repository on GitHub! master
```

GitHub's first hello. Default branch is still `master`.

### Commands

| Command | What it does            | Example      |
| ------- | ----------------------- | ------------ |
| `mcp`   | The MCP server on stdio | `forges mcp` |

There is no `forges repos`. MCP is the whole binary. `pnpm exec forges mcp` after install, or `pnpm add -g @agntn/forges` once.

## 🧠 Library

```ts
import { createProvider } from "@agntn/forges";

const github = await createProvider("github");
const repo = await github.repos.get("octocat", "Hello-World");

const { items, hasNextPage } = await github.pullRequests.list("octocat", "Hello-World", {
  state: "open",
});

const gitlab = await createProvider("gitlab", {
  token: "glpat-…",
  baseURL: "https://gitlab.example.com",
});
const gitbucket = await createProvider("github", {
  token: "…",
  baseURL: "https://gitbucket.example.com/api/v3",
});
```

Ten resources on every provider. `repos`, `issues`, `pullRequests`, `threads`. Then `commits`, `ciRuns`, `releases`, `contributionTemplates`, `code`, `users`. Lists come back as `items` plus `hasNextPage`. `totalCount` only when the forge counted. Search adds `incomplete` when the answer is known to be partial. Guides: [Authentication](https://forges.agntn.dev/guide/auth), [Repositories](https://forges.agntn.dev/guide/repositories), [Issues](https://forges.agntn.dev/guide/issues), [Pull requests](https://forges.agntn.dev/guide/pull-requests), [Review threads](https://forges.agntn.dev/guide/threads), [Commits, CI and releases](https://forges.agntn.dev/guide/commits), [Templates](https://forges.agntn.dev/guide/templates), [Code search](https://forges.agntn.dev/guide/code-search).

### Local Git

`@agntn/forges/local` checks a fetched checkout without changing it. Git with `--no-lazy-fetch` support must be on `PATH`; inspection also needs `ls-files --deduplicate`.

```ts
import { inspectLocal, verifyLocalMerge } from "@agntn/forges/local";

const inspection = await inspectLocal({
  cwd: "/path/to/checkout",
  paths: ["*AGENTS.md"],
  historyLimit: 3,
});

const evidence = await verifyLocalMerge({
  cwd: "/path/to/checkout",
  head: "topic",
  mergeCommit: "66c39f4bccd275e930420f408b7c311b9c494af8",
  target: "origin/main",
  paths: ["package.json", "README.md"],
});
console.log(evidence.mergeReachable, evidence.pathsMatch);
```

Tracked files are paged. Continue with `filesOffset: inspection.nextFilesOffset` until it is `null`, keeping `paths` unchanged. The [agent guide](https://forges.agntn.dev/guide/agents) covers limits and concurrent edits.

Replace the sample `mergeCommit` with the forge's actual merge or squash SHA for that PR, not the current target tip. The two booleans answer different questions: is that commit in the target's local history, and do the selected paths match the PR head? Neither authorizes deleting a branch. Details and limits: [Agents](https://forges.agntn.dev/guide/agents#local-merge-verification).

## 🗺️ Providers

| Platform                                                             | Provider             | Auth header            | Threads                       | Code search                        |
| -------------------------------------------------------------------- | -------------------- | ---------------------- | ----------------------------- | ---------------------------------- |
| [GitHub](https://forges.agntn.dev/platforms/github)                  | `github`             | `Authorization: token` | GraphQL, real flags           | global, owner, repository          |
| [GitLab](https://forges.agntn.dev/platforms/gitlab)                  | `gitlab`             | `Private-Token`        | REST discussions              | token required, Premium for global |
| [Gitea, Forgejo, Codeberg](https://forges.agntn.dev/platforms/gitea) | `gitea` + `baseURL`  | `Authorization: token` | one thread per review comment | none                               |
| [GitBucket](https://forges.agntn.dev/platforms/gitbucket)            | `github` + `baseURL` | `Authorization: token` | none                          | none                               |

Code search on Gitea is a 501, not an empty page. Host pages: [Platforms](https://forges.agntn.dev/platforms).

## 🤖 Agents

```bash
forges mcp
pi install npm:@agntn/forges
omp install @agntn/forges
```

```json
{
  "mcpServers": {
    "forges": { "command": "npx", "args": ["-y", "@agntn/forges", "mcp"] }
  }
}
```

MCP, Pi and OMP all hit the same 45 tools. Eight write to the host, so ask `forges_users_authenticated` who you are before a model does, details in the [Agents](https://forges.agntn.dev/guide/agents) guide.

## 🚫 What this does not do

Hosted files, trees, branches, plain tags, release assets, webhooks, org admin. The review loop is the scope: what was proposed, what was said, whether it passed, what shipped.

## 🧩 Adding a provider

A class extending `Provider`, the typed mappers, and a 501 for every method you skip. Copy from [Custom providers](https://forges.agntn.dev/guide/custom).

## 🛠️ Development

```bash
pnpm install
pnpm test        # vitest watch
pnpm test:run    # single run, as CI does
pnpm typecheck   # tsc, then build, then the extension graph
pnpm lint
pnpm docs        # the site, it bundles src/
pnpm run build   # obuild
```

## 💛 Thanks

I wrote a lot of this with help from [Claude for Open Source](https://claude.com/contact-sales/claude-for-oss) and [Codex for Open Source](https://developers.openai.com/community/codex-for-oss). Grateful for both <3

## 📄 License

[MIT](./LICENSE)

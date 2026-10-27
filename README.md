# @agntn/forges

[![npm version](https://npmx.dev/api/registry/badge/version/@agntn/forges)](https://npmx.dev/package/@agntn/forges)
[![npm downloads](https://npmx.dev/api/registry/badge/downloads/@agntn/forges)](https://npmx.dev/package/@agntn/forges)
[![license](https://npmx.dev/api/registry/badge/license/@agntn/forges)](https://npmx.dev/package/@agntn/forges)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/forges)

⚒️ Four forges, ten resources, 59 agent tools. Ask for a pull request, not another client.

## Why?

GitHub calls it a pull request. GitLab calls it a merge request. Even the page headers can't agree on a name. `@agntn/forges` gives your code one way to talk to both, and a few more hosts besides.

Docs and an explorer for the same calls: [forges.agntn.dev](https://forges.agntn.dev).

## ✨ Features

- 🧩 **Four forges, one `Provider`.** GitHub, GitLab, Gitea and GitBucket. Same `repos.get`, same `Issue`, same `PullRequest`.
- 🔑 **It finds the token.** Explicit value, then env, then `gh` or `glab`, then the CLI config file. First hit wins.
- 📦 **Loads one platform.** `createProvider("github")` is async. It imports GitHub and leaves GitLab on disk.
- 🆔 **IDs are strings.** Even when the API sent a number. A count the forge withholds is missing, not `0`.
- 🫥 **Empty string is guest.** `{ token: "" }` is anonymous on purpose. Leave `token` out and you get `AuthenticationError`, not a quiet guest session.
- 🤖 **59 tools, four surfaces.** MCP, Pi, OMP and the CLI share one definition of each. Fourteen tools write to the host.
- 🚫 **Missing is 501.** Code search on Gitea is not an empty page. You get a `ForgesError` with status 501.
- 🧭 **GitBucket is GitHub plus `baseURL`.** Forgejo and Codeberg are Gitea plus `baseURL`. Same class, different host.
- 🚚 **Built with [danielroe/forges](https://github.com/danielroe/forges).** It handles forge requests and pagination. This package adds its own normalized API and agent tools.
- ☁️ **Cloudflare Artifacts too.** Git without the forge. Repos, files and the log through the same calls, with the namespace as `owner`. Ask it for issues and you get a 501, because there's nobody there to file one.

## 📦 Install

```bash
pnpm add @agntn/forges
```

Node.js 26 or newer.

## 🚀 First call

```ts
import { createProvider } from "@agntn/forges";

const codeberg = await createProvider("gitea", {
  token: "",
  baseURL: "https://codeberg.org",
});

const repo = await codeberg.repos.get({ owner: "forgejo", repo: "forgejo" });
console.log(repo.fullName, repo.description, repo.defaultBranch);
```

```
forgejo/forgejo Beyond coding. We forge. forgejo
```

They said it, not me. No key needed here. Pass the host and an empty token for guest access.

Logged into `gh`? Drop the config object.

```ts
const github = await createProvider("github");
const hello = await github.repos.get({ owner: "octocat", repo: "Hello-World" });
console.log(hello.fullName, hello.description, hello.defaultBranch);
```

```
octocat/Hello-World My first repository on GitHub! master
```

GitHub's first hello. Default branch is still `master`.

### Commands

Every agent tool is a command too. Drop the `forges_` prefix, swap underscores for dashes, and `forges_repos_get` becomes `forges repos-get`:

| Want to...           | Run                                                                         |
| -------------------- | --------------------------------------------------------------------------- |
| Read a repository    | `forges repos-get --repo octocat/Hello-World`                               |
| Find open bugs       | `forges issues-search-global --owner agntn --state open --labels '["bug"]'` |
| Start the MCP server | `forges mcp`                                                                |

Options match the tool arguments. Lists and objects go in as JSON. Add `--json` for details instead of text.

Run `forges --help` for commands or `forges <command> --help` for options. Install globally with `pnpm add -g @agntn/forges`, or use `pnpm exec forges` inside your project.

## 🧠 Library

```ts
import { createProvider } from "@agntn/forges";

const github = await createProvider("github");
const hello = { owner: "octocat", repo: "Hello-World" };
const repo = await github.repos.get(hello);

const open = await github.pullRequests.list(hello, { state: "open" });
if (open.nextCursor) {
  const more = await github.pullRequests.list(hello, { state: "open", cursor: open.nextCursor });
  console.log(more.items);
}

const gitlab = await createProvider("gitlab", {
  token: "glpat-…",
  baseURL: "https://gitlab.example.com",
});
const gitbucket = await createProvider("github", {
  token: "…",
  baseURL: "https://gitbucket.example.com/api/v3",
});
```

Lists return `items` and, when there is another page, `nextCursor`. Pass that cursor back unchanged. Don't make one up: the provider refuses it. Search can also report an incomplete result.

Guides: [Authentication](https://forges.agntn.dev/guide/auth), [Repositories](https://forges.agntn.dev/guide/repositories), [Issues](https://forges.agntn.dev/guide/issues), [Pull requests](https://forges.agntn.dev/guide/pull-requests), [Review threads](https://forges.agntn.dev/guide/threads), [Commits, CI and releases](https://forges.agntn.dev/guide/commits), [Templates](https://forges.agntn.dev/guide/templates), [Code search](https://forges.agntn.dev/guide/code-search).

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

Status rows and tracked files are paged separately. Continue with `statusOffset: inspection.nextStatusOffset` or `filesOffset: inspection.nextFilesOffset` until it's `null`, keeping `paths` unchanged. Limits and the concurrent edit caveat sit in the JSDoc of `inspectLocal` and its options.

Replace the sample `mergeCommit` with the forge's actual merge or squash SHA for that PR, not the current target tip. The two booleans answer different questions: is that commit in the target's local history, and do the selected paths match the PR head? Neither authorizes deleting a branch.

## 🗺️ Providers

| Platform                                                             | Provider             | Auth header             | Threads                       | Code search                        |
| -------------------------------------------------------------------- | -------------------- | ----------------------- | ----------------------------- | ---------------------------------- |
| [GitHub](https://forges.agntn.dev/platforms/github)                  | `github`             | `Authorization: token`  | GraphQL, real flags           | global, owner, repository          |
| [GitLab](https://forges.agntn.dev/platforms/gitlab)                  | `gitlab`             | `Private-Token`         | REST discussions              | token required, Premium for global |
| [Gitea, Forgejo, Codeberg](https://forges.agntn.dev/platforms/gitea) | `gitea` + `baseURL`  | `Authorization: token`  | one thread per review comment | none                               |
| [GitBucket](https://forges.agntn.dev/platforms/gitbucket)            | `github` + `baseURL` | `Authorization: token`  | none                          | none                               |
| [Cloudflare Artifacts](https://forges.agntn.dev/platforms/artifacts) | `artifacts`          | `Authorization: Bearer` | none                          | none                               |

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

MCP, Pi and OMP all hit the same 59 tools. Fourteen write to the host, so ask `forges_users_authenticated` who you are before a model does, details in the [Agents](https://forges.agntn.dev/guide/agents) guide.

## 🚫 What this does not do

Repository files can be read without cloning. Branch management, release assets, webhooks and organization administration are outside the review loop.

## 🧩 Adding a provider

A class extending `Provider`, the typed mappers, and a 501 for every method you skip. Copy from [Custom providers](https://forges.agntn.dev/guide/custom).

## 🛠️ Development

```bash
pnpm install     # docs/ too, one workspace and one lockfile
pnpm test        # vp test in watch mode
pnpm test:run    # single run, as CI does
pnpm typecheck   # tsc, then build, then the extension graph
pnpm lint
pnpm run docs    # the site, it bundles src/
pnpm run build   # obuild
```

The `run` in `pnpm run docs` isn't decoration. Bare `pnpm docs` is pnpm 12's own command, and all you get back is `Usage: pnpm docs <PACKAGE>`. Versions live in the catalogs of `pnpm-workspace.yaml`, so one line bumps Nuxt for the site and `unstorage` for the library and the worker alike.

## 💛 Thanks

I wrote a lot of this with help from [Claude for Open Source](https://claude.com/contact-sales/claude-for-oss) and [Codex for Open Source](https://developers.openai.com/community/codex-for-oss). Grateful for both <3

## 📄 License

[MIT](./LICENSE)

# AGENTS.md — forges

Unified TypeScript API for GitHub, GitLab, Gitea, and GitBucket. Normalizes auth headers, pagination, and field names behind a single abstract `Provider` base class. Requests go through native `fetch` and the cache through unstorage, with Vite+ for lint, format and tests, and obuild for the bundle. ESM only.

## Quick Commands

```bash
pnpm i                          # install deps (pnpm 10.x, node >=26)
pnpm dev                        # obuild --stub
pnpm run build                  # obuild → dist/ (.mjs + .d.mts)
pnpm typecheck                  # tsc --noEmit (strict mode)
pnpm test                       # vp test in watch mode
pnpm test:run                   # single run (CI)
pnpm test:packed                # load both extensions from a published-shaped layout
pnpm release                    # test → build → changelogen → push tag
```

**Run a single test file:**

```bash
pnpm exec vp test run test/github.test.ts
```

**Run a single test by name:**

```bash
pnpm exec vp test run -t "lists a directory"
```

**CI order:** typecheck → build → test:packed → test (see `.github/workflows/test.yml`).

## Codebase Map

```
src/
├── index.ts              # createProvider() factory — async, imports one provider module on demand
├── provider.ts           # Runtime abstract Provider base + typed mapper contract
├── types.ts              # Resource interfaces and unified data models (type-only)
├── auth.ts               # resolveToken() over @agntn/credentials: explicit → env → CLI → config
├── http.ts               # Native fetch client with auth headers, retry, rate limit
├── cache.ts              # unstorage LRU cache — GET-only, lazy-initialized
├── errors.ts             # FetchError, ForgesError hierarchy + normalizeError()
├── ci-run.ts             # Cross-platform CI/check status and conclusion normalization
├── ci-job-log.ts         # CI job mapping, log cleanup, bounded log stream with failing steps first
├── review.ts             # Review verdict normalization: GitHub and Gitea reviews, GitLab reviewer stances
├── changed-file.ts       # Changed-file status normalization + GitLab diff line counts
├── commit-patch.ts       # Bounded commit patch stream rendering and continuation
├── update-input.ts       # Issue and pull request update and merge checks + whole-list assignee merge for GitLab and Gitea
├── pagination.ts         # Link header + x-next-page async generator, local page slicing
├── version.ts            # Package version — the one source for it in src/
├── tool-operations.ts    # Executors behind every agent surface (MCP, Pi, OMP, CLI) + toolFailure()
├── tool-schemas.ts       # ForgesPlatform + the TypeBox parameters, built with `Type` from @agntn/tools
├── tools.ts              # forgesTools(): one defineTool per tool, executors loaded on the first call
├── mcp.ts                # createMcpServer() from @agntn/tools/mcp, with the forges title and website
├── cli.ts                # runCli() from @agntn/tools/cli; a bare `mcp` serves src/ in a checkout
├── commands/mcp.ts       # serveMcp(): `forges mcp` over stdio
├── github.ts             # Sub-path re-export for @agntn/forges/github
├── gitlab.ts             # Sub-path re-export for @agntn/forges/gitlab
├── gitea.ts              # Sub-path re-export for @agntn/forges/gitea
└── providers/
    ├── base-url.ts       # Base URL normalization + safe API path encoding
    ├── github.ts         # Class. Also handles GitBucket via baseURL
    ├── gitlab.ts         # Class. Project ID resolution + caching, Private-Token auth
    └── gitea.ts          # Class. limit param, null-safe fields
packages/
├── shared/
│   ├── tool-effects.ts          # Each tool's effect: MCP hints, OMP approval, the (write) mark
│   ├── tui.ts                   # Status lines and result previews for Pi and OMP
│   └── lazy.ts                  # lazy(load): one shared in-flight load, retried after a rejection
├── pi/extensions/forges.ts      # registerPiTools() + the six approval dialogs
└── omp/extensions/forges.ts     # registerOmpTools() under the Forges label
test/
├── *.test.ts             # Unit suites plus integration and agent-surface coverage
└── eval-packed-extensions.mjs   # Loads both extensions from a published-shaped layout
```

**Where to put new code:**

| Task                          | Location                           | Notes                                                                                                                    |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Add new provider              | `src/providers/`                   | Copy github.ts as template. Extend the abstract `Provider` base, add its loader to the `providers` map in `src/index.ts` |
| Add new resource              | `src/types.ts` → provider files    | Define interface in types.ts, implement in each provider                                                                 |
| Change contribution templates | `src/provider.ts` + provider files | Keep lists metadata-only; `get` must resolve an exact listed key                                                         |
| Change auth logic             | `@agntn/credentials`               | The chain lives there; `src/auth.ts` only maps a platform to its `resolve()`                                             |
| Change cache backend          | `src/cache.ts`                     | `configureStorage()` swaps unstorage driver                                                                              |
| Fix pagination                | `src/pagination.ts`                | `parseLinkHeader()` for GitHub/Gitea, `x-next-page` for GitLab                                                           |
| Fix error mapping             | `src/errors.ts`                    | `normalizeError()` maps FetchError → ForgesError subtypes                                                                |
| Add sub-path export           | `build.config.ts` + `package.json` | Must update both: bundle `input` + exports map                                                                           |
| Add agent tool                | `src/tool-operations.ts`           | Executor first, then its `defineTool` in `src/tools.ts` and its effect in `packages/shared/tool-effects.ts`              |
| Change tool schema            | `src/tool-schemas.ts`              | `forgesToolSchemas()` builds them once for every surface; `Type` comes from `@agntn/tools`, never `typebox`              |
| Debug HTTP                    | `src/http.ts`                      | `rawFetch()` returns headers, `createHttpClient()` configures auth                                                       |
| Add tests                     | `test/`                            | Name must match `test/<module>.test.ts`                                                                                  |

## Code Conventions

### Imports

- ESM only (`type: "module"` in package.json, `.mjs` output)
- Use explicit `.ts` extensions in relative source imports: `import { Foo } from './bar.ts'`
- Use `import type` for type-only imports
- Node builtins use `node:` prefix: `node:child_process`, `node:fs`
- TypeScript uses NodeNext resolution with `allowImportingTsExtensions` and `noEmit`; obuild owns JavaScript and declaration emission
- The OMP extension must keep both dynamic imports literal: `existsSync(src)` chooses `import("../../../src/tools.ts")` or `import("../../../dist/tools.mjs")`. Never `import(url.href)`.

### TypeScript

- **Strict mode** — plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, and `noFallthroughCasesInSwitch`
- **Erasable syntax only:** no parameter properties, enums or namespaces. The OMP extension loads `src/*.ts` in a checkout, and plain `node` can only strip types, not transform them
- **Target:** ESNext, **module:** NodeNext, **moduleResolution:** NodeNext
- **No `as any` or `@ts-ignore`** — use proper generics
- **IDs are strings** — always `String(raw.id)`, even when APIs return numbers

### Provider method structure

Provider operations normalize transport errors at their boundary:

```typescript
try {
  const data = await this.client<RawType>(url);
  return this.mapRepository(data);
} catch (error) {
  throw normalizeError(error, "platform");
}
```

Use `cachedFetch` only for stable item reads. Repository, issue, pull request, release, discussion comment, and user item reads use the client directly because callers rely on current state.

### Mapper methods

The abstract `Provider` requires typed `mapOwner`, `mapRepository`, `mapIssue`,
`mapPullRequest`, `mapUser`, and `mapThread` methods. Each concrete provider supplies its raw
API response types and implements these protected mappers without side effects.
Provider operations invoke them through `this`.

### Resource binding

The abstract `Provider` constructor binds resource objects to protected platform-specific methods.

### Auth headers

| Platform | Header          | Format    |
| -------- | --------------- | --------- |
| GitHub   | `Authorization` | `token X` |
| GitLab   | `Private-Token` | `X`       |
| Gitea    | `Authorization` | `token X` |

Configured via `tokenHeader`/`tokenPrefix` in `createHttpClient()`.

### Key rules

- **Token check:** use `!== undefined` not falsy check. Empty string is intentional (allow unauthenticated).
- **Tool targets:** `platform` defaults to `github` and `repo` may arrive as `owner/name`. `repositoryTarget()` in `src/tool-operations.ts` resolves both once for every surface, accepts an `owner` that repeats the slug's owner (case-insensitive), and rejects one that names someone else instead of picking one.
- **Agent auth boundary:** read executors may fall back to an isolated empty-token provider; writes and `users.authenticated` must use the credentialed provider map.
- **Named account:** a write's `account` pins its own provider next to the default one, and only after `/user` returns that login. An env token still wins the lookup, so the check is what stops a write signed by someone else. GitHub only; the other platforms reject it.
- **List vs Get:** list operations use `rawFetch` for pagination headers. Stable item reads use `cachedFetch`; repository, issue, pull request, release, discussion comment, and user item reads use the client directly.
- **No raw error throws** — always `throw normalizeError(error, platform)`.
- **No cache for mutations** — `cachedFetch` rejects non-GET automatically.
- **A write without an answer may have landed.** `normalizeError()` tells a write that hit a 5xx, or lost its response after it left, to check before sending it again. It reads the method off the FetchError, counts a GraphQL POST only for a `mutation`, and skips a connection that never opened (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `UND_ERR_CONNECT_TIMEOUT`).
- **No hardcoded URLs** — all providers accept `baseURL` config.
- **No `execSync`** — use `execFileSync` with arg arrays (command injection prevention).
- **No CJS** — ESM only everywhere.
- **Local MCP serves `src/`.** Inside a checkout, the built `dist/cli.mjs` loads the `mcp` command from `src/`, bypassing the `mcp` that `runCli` generates because that one can't carry the title and website, like the Pi and OMP extensions, so a local server needs only a restart after a change. The npm package ships no `src/` and runs the bundle, and so does a copy under `node_modules` or a Node started with `--no-experimental-strip-types`. `FORGES_DIST=1` forces the bundle. A change to `src/cli.ts` itself still needs `pnpm build`; `test:packed` runs `mcp` in each of these layouts.
- **One definition per tool.** `src/tools.ts` declares each tool once with `defineTool` from `@agntn/tools`, and the MCP server, both extensions and the CLI register that list through the adapters, so a schema, a description or a validation line can't drift between surfaces. Schemas take `Type` from `@agntn/tools`, never from `typebox`: OMP rewrites that bare import to its own facade and validation quietly disappears. TypeBox comes bundled inside `@agntn/tools`, so it is no dependency or peer here, only a devDependency for `Value.Check` in tests. `test/extensions.test.ts` fails on a host package in `dependencies` or a `typebox` peer, `test:packed` on a `dist` file that imports `typebox`.
- **Pi asks before six writes.** `confirm` in `packages/pi/extensions/forges.ts` builds the dialog for release create and update, issue update, and pull request create, update and merge from the target `repositoryTarget()` resolved, so the dialog names the repository the write goes to. The adapter validates first and refuses without a UI. OMP needs no dialog: `approval: "write"` puts the host's own approval in front of every write.
- **Nothing runs at import.** `sideEffects: false` is a claim about every module: no calls, registrations, or `process.env` reads at module scope, and heavy dependencies (provider modules, the executors, the MCP SDK) load on the call path through literal `import()`. `forgesTools()` builds the definitions on its first call, not at import. Literals, `new Set([...])` and `Symbol.for()` need no hint, rolldown drops them unused; a module-scope call to a project helper such as `lazy()` carries `/* @__PURE__ */`.

## Testing

**Test imports** - test files import from `vite-plus/test`, not `vitest`.

**Mock pattern** — tests use `vi.hoisted()` to create mocks before imports:

```typescript
const mocks = vi.hoisted(() => {
  const client = vi.fn();
  return {
    client,
    createHttpClient: vi.fn(() => client),
    cachedFetch: vi.fn(),
    rawFetch: vi.fn(),
  };
});

vi.mock("../src/http.ts", () => ({
  createHttpClient: mocks.createHttpClient,
  rawFetch: mocks.rawFetch,
}));
vi.mock("../src/cache.ts", () => ({ cachedFetch: mocks.cachedFetch }));
```

**Fixtures** — raw API response objects (snake_case) defined at file top. Match real API shape.

**Error helper** — `makeFetchError(status)` creates a `FetchError` from `src/errors.ts` with status code. `test/http.test.ts` stubs the global `fetch` with native `Response` objects.

**Test hygiene** — `vi.resetAllMocks()` + env restore in `beforeEach`/`afterEach`. No test pollution.

**Test config** - the `test` block in `vite.config.ts`: `environment: "node"`, `globals: true`, and `@agntn/forges` aliased to `src/index.ts` as the docs worker does. Vitest 5 clears mock history before each test. No coverage thresholds. The top-level `tsconfig` pins the root one, so `test/docs-query.test.ts` can load a docs module without `docs/.nuxt`, which CI never generates.

## Execution Workflow

1. **Explore** — read relevant source files before making changes. Understand the existing pattern.
2. **Plan** — for non-trivial changes, state what you'll change and why.
3. **Edit** — make focused changes. Follow existing patterns in the file.
4. **Verify** — run after every change:
   ```bash
   pnpm typecheck && pnpm test:run
   ```
   If you changed a single module, run its test first: `pnpm exec vp test run test/<module>.test.ts`
5. **Keep diffs small** — one concern per change. Don't refactor adjacent code.

## Safety and Git Hygiene

- Do not commit unless explicitly asked.
- Do not push unless explicitly asked.
- No destructive git operations (`reset --hard`, `push --force`) without explicit request.
- Never commit `.env`, credentials, or tokens.
- Do not skip hooks (`--no-verify`).
- New commits over amending — especially after hook failures.

## Communication Style

- Concise and direct. Lead with the answer.
- Technical precision — use correct names for types, functions, files.
- Explain _why_ for non-obvious decisions, skip the _what_ when the diff speaks.
- No filler, no trailing summaries, no template prose.

## Platform-Specific Notes

- **GitBucket** works via GitHub provider with custom `baseURL` — no separate provider needed.
- **GitLab `/users/:owner/projects`** returns 404 for groups — `listRepos` falls back to `/groups/:owner/projects` only on 404, re-throws other errors.
- **GitHub `/issues` returns PRs** — filtered by absence of `pull_request` key.
- **GitHub template scope is explicit:** repository files and inherited owner `.github` defaults are different scopes; local overrides apply independently to issue and pull-request templates.
- **GitLab uses `iid`** (project-scoped) not `id` (global) for issue/MR numbers.
- **Releases are keyed by tag** because GitLab releases have no id; GitHub and Gitea update by the id a tag read returns. GitLab has no draft or prerelease flag, so `true` for either is a 501 there, never a silent publish.
- **GitLab template provenance can be hidden:** use the effective template API and leave inherited source fields unknown rather than guessing a group or instance source.
- **Pull request edits change lists, never replace them:** `addAssignees`/`removeAssignees` and `addLabels`/`removeLabels`. GitLab and Gitea take assignees only as the whole list, so they read the pull request first; `draft` stays out: none of the three REST edit routes takes it.
- **Merges pin the head.** `pullRequests.merge` passes `headSha` as each platform's guard (`sha`, `head_commit_id`), so a push after review is a 409, and `normalizeMergeError()` adds the next step to 405, 409 and a 5xx, which may have merged anyway. GitHub and Gitea read the pull request after the merge in a `try` of its own, so a failed read says the merge went through. GitLab picks merge commit or rebase per project, so `method: "rebase"` is a 501 there, and it takes the commit message whole, so `message` needs `title`.
- **Issue edits follow the same input.** GitHub and Gitea serve pull requests on the issue route, so `issues.update` reads the number first and answers `NotFoundError` for a pull request before any write. `state_reason` stays out: GitLab and Gitea have no counterpart.
- **Gitea uses `limit`** param, not `per_page`.
- **Gitea labels lie on search.** Both Gitea and Forgejo drop an unknown label name and return the rows unfiltered, and `/repos/issues/search` matches any of several labels while the repository list wants all. `issues.searchGlobal` keeps only rows with every label and answers an empty page once a row proves the filter was dropped.
- **Gitea templates are repository-scoped:** do not claim GitHub-style owner inheritance.
- **unstorage memory driver has no TTL** — that's why lru-cache driver is used.

# AGENTS.md — forges

Unified TypeScript API for GitHub, GitLab, Gitea, and GitBucket. Normalizes auth headers, pagination, and field names behind a single abstract `Provider` base class. Built on unjs stack (obuild, ofetch, unstorage). ESM only.

## Quick Commands

```bash
pnpm i                          # install deps (pnpm 10.x, node >=22)
pnpm dev                        # obuild --stub (dev mode with live types)
pnpm run build                  # obuild → dist/ (.mjs + .d.mts)
pnpm typecheck                  # tsc --noEmit (strict mode)
pnpm test                       # vitest watch mode
pnpm test:run                   # single run (CI)
pnpm test:packed                # load both extensions from a published-shaped layout
pnpm release                    # test → build → changelogen → push tag
```

**Run a single test file:**

```bash
pnpm vitest run test/github.test.ts
```

**Run a single test by name:**

```bash
pnpm vitest run -t "should list repos"
```

**CI order:** typecheck → build → test:packed → test (see `.github/workflows/test.yml`).

## Codebase Map

```
src/
├── index.ts              # createProvider() factory — single public entry point
├── provider.ts           # Runtime abstract Provider base + typed mapper contract
├── types.ts              # Resource interfaces and unified data models (type-only)
├── auth.ts               # 4-level token detection: explicit → env → CLI → config
├── http.ts               # ofetch wrapper with auth headers, retry, rate limit
├── cache.ts              # unstorage LRU cache — GET-only, lazy-initialized
├── errors.ts             # ForgesError hierarchy + normalizeError()
├── ci-run.ts             # Cross-platform CI/check status and conclusion normalization
├── changed-file.ts       # Changed-file status normalization + GitLab diff line counts
├── pagination.ts         # Link header + x-next-page async generator
├── version.ts            # Package version — the one source for it in src/
├── tool-operations.ts    # Executors behind every agent surface (MCP, Pi, OMP)
├── mcp.ts                # createMcpServer() over the low-level MCP Server
├── cli.ts                # citty entry for the `forges` bin
├── commands/mcp.ts       # `forges mcp` — stdio transport
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
│   └── forges-tool-schemas.ts   # ForgesPlatform + TypeBox parameters shared by src/mcp.ts and Pi
├── pi/extensions/forges.ts      # Pi extension — imports the shared schemas
└── omp/extensions/forges.ts     # OMP extension — rebuilds them with the host TypeBox
test/
├── *.test.ts             # Unit suites plus integration and agent-surface coverage
└── eval-packed-extensions.mjs   # Loads both extensions from a published-shaped layout
```

**Where to put new code:**

| Task                 | Location                            | Notes                                                              |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Add new provider     | `src/providers/`                    | Copy github.ts as template. Extend the abstract `Provider` base    |
| Add new resource     | `src/types.ts` → provider files     | Define interface in types.ts, implement in each provider           |
| Change auth logic    | `src/auth.ts`                       | `resolveToken()` chain — order matters                             |
| Change cache backend | `src/cache.ts`                      | `configureStorage()` swaps unstorage driver                        |
| Fix pagination       | `src/pagination.ts`                 | `parseLinkHeader()` for GitHub/Gitea, `x-next-page` for GitLab     |
| Fix error mapping    | `src/errors.ts`                     | `normalizeError()` maps FetchError → ForgesError subtypes          |
| Add sub-path export  | `build.config.mjs` + `package.json` | Must update both: entries array + exports map                      |
| Add agent tool       | `src/tool-operations.ts`            | Executor first, then `src/mcp.ts` and both extensions              |
| Change tool schema   | `packages/shared/`                  | MCP and Pi share it; OMP rebuilds it from `pi.typebox`             |
| Debug HTTP           | `src/http.ts`                       | `rawFetch()` returns headers, `createHttpClient()` configures auth |
| Add tests            | `test/`                             | Name must match `test/<module>.test.ts`                            |

## Code Conventions

### Imports

- ESM only (`type: "module"` in package.json, `.mjs` output)
- Use explicit `.ts` extensions in relative source imports: `import { Foo } from './bar.ts'`
- Use `import type` for type-only imports
- Node builtins use `node:` prefix: `node:child_process`, `node:fs`
- TypeScript uses NodeNext resolution with `allowImportingTsExtensions` and `noEmit`; obuild owns JavaScript and declaration emission
- The OMP extension must keep both dynamic imports literal: `existsSync(src)` chooses `import("../../../src/tool-operations.ts")` or `import("../../../dist/tool-operations.mjs")`. Never `import(url.href)`.

### TypeScript

- **Strict mode** — plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, and `noFallthroughCasesInSwitch`
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

Use `cachedFetch` only for stable item reads. Repository, issue, pull request, discussion comment, and user item reads use the client directly because callers rely on current state.

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
- **Agent auth boundary:** read executors may fall back to an isolated empty-token provider; writes and `users.authenticated` must use the credentialed provider map.
- **List vs Get:** list operations use `rawFetch` for pagination headers. Stable item reads use `cachedFetch`; repository, issue, pull request, discussion comment, and user item reads use the client directly.
- **No raw error throws** — always `throw normalizeError(error, platform)`.
- **No cache for mutations** — `cachedFetch` rejects non-GET automatically.
- **No hardcoded URLs** — all providers accept `baseURL` config.
- **No `execSync`** — use `execFileSync` with arg arrays (command injection prevention).
- **No CJS** — ESM only everywhere.

## Testing

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

**Error helper** — `makeFetchError(status)` creates mock FetchError with status code.

**Test hygiene** — `vi.resetAllMocks()` + env restore in `beforeEach`/`afterEach`. No test pollution.

**Vitest config** — `environment: "node"`, `globals: true`. No coverage thresholds.

## Execution Workflow

1. **Explore** — read relevant source files before making changes. Understand the existing pattern.
2. **Plan** — for non-trivial changes, state what you'll change and why.
3. **Edit** — make focused changes. Follow existing patterns in the file.
4. **Verify** — run after every change:
   ```bash
   pnpm typecheck && pnpm test:run
   ```
   If you changed a single module, run its test first: `pnpm vitest run test/<module>.test.ts`
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
- **GitLab uses `iid`** (project-scoped) not `id` (global) for issue/MR numbers.
- **Gitea uses `limit`** param, not `per_page`.
- **unstorage memory driver has no TTL** — that's why lru-cache driver is used.

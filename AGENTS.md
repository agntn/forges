# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-05
**Commit:** 9d89386
**Branch:** main

## OVERVIEW

Unified TypeScript API for GitHub, GitLab, Gitea, and GitBucket. Normalizes API differences (auth headers, pagination, field names) behind a single `Provider` interface. Built on unjs stack: obuild, ofetch, unstorage.

## STRUCTURE

```
src/
├── index.ts              # createProvider() factory — single public entry point
├── types.ts              # Provider interface, resource interfaces, unified models
├── auth.ts               # 4-level token detection chain (explicit → env → CLI → config)
├── http.ts               # ofetch wrapper with configurable auth headers
├── cache.ts              # unstorage LRU cache — GET-only, lazy-initialized
├── errors.ts             # GixaError hierarchy + normalizeError()
├── pagination.ts         # Link header + x-next-page async generator
├── github.ts             # Sub-path re-export for gixa/github
├── gitlab.ts             # Sub-path re-export for gixa/gitlab
├── gitea.ts              # Sub-path re-export for gixa/gitea
└── providers/
    ├── github.ts         # Class. Also handles GitBucket via baseURL
    ├── gitlab.ts         # Class. Project ID resolution + caching, Private-Token auth
    └── gitea.ts          # Factory function. limit param, null-safe fields
test/
└── *.test.ts             # 1:1 mirror of src/ + integration.test.ts
```

## WHERE TO LOOK

| Task                 | Location                           | Notes                                                              |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| Add new provider     | `src/providers/`                   | Copy github.ts as template. Implement `Provider` interface         |
| Add new resource     | `src/types.ts` → provider files    | Define interface in types.ts, implement in each provider           |
| Change auth logic    | `src/auth.ts`                      | resolveToken() chain — order matters                               |
| Change cache backend | `src/cache.ts`                     | `configureStorage()` swaps unstorage driver                        |
| Fix pagination       | `src/pagination.ts`                | `parseLinkHeader()` for GitHub/Gitea, `x-next-page` for GitLab     |
| Fix error mapping    | `src/errors.ts`                    | `normalizeError()` maps FetchError → GixaError subtypes            |
| Add sub-path export  | `build.config.ts` + `package.json` | Must update both: entries array + exports map                      |
| Debug HTTP           | `src/http.ts`                      | `rawFetch()` returns headers, `createHttpClient()` configures auth |

## CODE MAP

| Symbol                | Type            | File                | Role                                                    |
| --------------------- | --------------- | ------------------- | ------------------------------------------------------- |
| `createProvider`      | factory         | index.ts            | Main entry — resolves auth, instantiates provider       |
| `Provider`            | interface       | types.ts            | 4 resources: repos, issues, pullRequests, users         |
| `resolveToken`        | function        | auth.ts             | Auth chain: explicit → env → CLI → config file          |
| `createHttpClient`    | function        | http.ts             | ofetch.create() with auth headers, retry, rate limit    |
| `rawFetch`            | function        | http.ts             | Returns data + headers (needed for pagination)          |
| `cachedFetch`         | function        | cache.ts            | GET-only cache via unstorage LRU                        |
| `normalizeError`      | function        | errors.ts           | FetchError → NotFoundError / AuthError / RateLimitError |
| `paginate`            | async generator | pagination.ts       | Handles Link + x-next-page headers                      |
| `GitHubProvider`      | class           | providers/github.ts | Also serves GitBucket                                   |
| `GitLabProvider`      | class           | providers/gitlab.ts | Has internal projectIdCache                             |
| `createGiteaProvider` | factory         | providers/gitea.ts  | Factory, not class                                      |

## CONVENTIONS

**Provider method structure** — every public method follows this pattern:

```typescript
try {
  const data = await cachedFetch<RawType>(this.client, url);
  return mapFunction(data);
} catch (error) {
  throw normalizeError(error, "platform");
}
```

**Mapper functions** — each provider defines raw API interfaces (snake_case) and mapper functions that convert to unified types (camelCase). Mappers are pure functions, not methods.

**Resource binding** — resources (repos, issues, etc.) are object literals bound in constructor, delegating to private methods.

**Auth header config** — GitHub uses `Authorization: token X`, GitLab uses `Private-Token: X`, Gitea uses `Authorization: token X`. Configured via `tokenHeader`/`tokenPrefix` in `createHttpClient()`.

**Token check** — use `!== undefined` not falsy check. Empty string is intentional (allow unauthenticated).

**List vs Get** — list operations use `rawFetch` (need headers for pagination), get operations use `cachedFetch`.

**ID normalization** — all IDs are strings in unified types (`String(raw.id)`), even when APIs return numbers.

## ANTI-PATTERNS

- **No `as any` or `@ts-ignore`** — strict TypeScript, use proper generics
- **No raw error throws** — always `throw normalizeError(error, platform)`
- **No cache for mutations** — `cachedFetch` rejects non-GET automatically
- **No hardcoded URLs** — all providers accept `baseURL` config
- **No `execSync`** — use `execFileSync` with arg arrays (command injection prevention)
- **No CJS** — ESM only, `type: "module"`, `.mjs` output
- **No test pollution** — `vi.resetAllMocks()` + env restore in beforeEach/afterEach

## TESTING

**Mock pattern** — tests use `vi.hoisted()` to create mocks before imports:

```typescript
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  createHttpClient: vi.fn(() => client),
  cachedFetch: vi.fn(),
  rawFetch: vi.fn(),
}));
vi.mock("../src/http.js", () => ({
  createHttpClient: mocks.createHttpClient,
  rawFetch: mocks.rawFetch,
}));
vi.mock("../src/cache.js", () => ({ cachedFetch: mocks.cachedFetch }));
```

**Fixtures** — raw API response objects (snake_case) defined at file top. Match real API shape.

**Error helper** — `makeFetchError(status)` creates mock FetchError with status code.

**200 tests total**, 9 test files. No coverage thresholds configured.

## COMMANDS

```bash
pnpm test          # vitest watch mode
pnpm test:run      # single run (CI)
pnpm run build     # obuild → dist/
pnpm typecheck     # tsc --noEmit
pnpm release       # test → build → changelogen → push tag
```

## NOTES

- **GitBucket** works via GitHub provider with custom `baseURL` — no separate provider needed
- **GitLab `/users/:owner/projects`** returns 404 for groups — `listRepos` falls back to `/groups/:owner/projects` only on 404, re-throws other errors
- **GitHub `/issues` returns PRs** — filtered by absence of `pull_request` key
- **GitLab uses `iid`** (project-scoped) not `id` (global) for issue/MR numbers
- **Gitea uses `limit`** param, not `per_page`
- **unstorage memory driver has no TTL** — that's why lru-cache driver is used
- **Node ≥22 required** — ES2024 target, uses modern APIs
- **CI runs typecheck → build → test** in that order (test.yml on every push, release.yml on `v*` tags)

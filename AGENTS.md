# AGENTS.md — gixa

Unified TypeScript API for GitHub, GitLab, Gitea, and GitBucket. Normalizes auth headers, pagination, and field names behind a single `Provider` interface. Built on unjs stack (obuild, ofetch, unstorage). ESM only.

## Quick Commands

```bash
pnpm i                          # install deps (pnpm 10.x, node >=22)
pnpm dev                        # obuild --stub (dev mode with live types)
pnpm run build                  # obuild → dist/ (.mjs + .d.mts)
pnpm typecheck                  # tsc --noEmit (strict mode)
pnpm test                       # vitest watch mode
pnpm test:run                   # single run (CI)
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

**CI order:** typecheck → build → test (see `.github/workflows/test.yml`).

## Codebase Map

```
src/
├── index.ts              # createProvider() factory — single public entry point
├── types.ts              # Provider interface, resource interfaces, unified models
├── auth.ts               # 4-level token detection: explicit → env → CLI → config
├── http.ts               # ofetch wrapper with auth headers, retry, rate limit
├── cache.ts              # unstorage LRU cache — GET-only, lazy-initialized
├── errors.ts             # GixaError hierarchy + normalizeError()
├── pagination.ts         # Link header + x-next-page async generator
├── github.ts             # Sub-path re-export for gixa/github
├── gitlab.ts             # Sub-path re-export for gixa/gitlab
├── gitea.ts              # Sub-path re-export for gixa/gitea
└── providers/
    ├── base-url.ts       # Base URL normalization for self-hosted instances
    ├── github.ts         # Class. Also handles GitBucket via baseURL
    ├── gitlab.ts         # Class. Project ID resolution + caching, Private-Token auth
    └── gitea.ts          # Factory function. limit param, null-safe fields
test/
└── *.test.ts             # 1:1 mirror of src/ + integration.test.ts (9 files, ~200 tests)
```

**Where to put new code:**

| Task | Location | Notes |
|------|----------|-------|
| Add new provider | `src/providers/` | Copy github.ts as template. Implement `Provider` interface |
| Add new resource | `src/types.ts` → provider files | Define interface in types.ts, implement in each provider |
| Change auth logic | `src/auth.ts` | `resolveToken()` chain — order matters |
| Change cache backend | `src/cache.ts` | `configureStorage()` swaps unstorage driver |
| Fix pagination | `src/pagination.ts` | `parseLinkHeader()` for GitHub/Gitea, `x-next-page` for GitLab |
| Fix error mapping | `src/errors.ts` | `normalizeError()` maps FetchError → GixaError subtypes |
| Add sub-path export | `build.config.ts` + `package.json` | Must update both: entries array + exports map |
| Debug HTTP | `src/http.ts` | `rawFetch()` returns headers, `createHttpClient()` configures auth |
| Add tests | `test/` | Name must match `test/<module>.test.ts` |

## Code Conventions

### Imports

- ESM only (`type: "module"` in package.json, `.mjs` output)
- Use `.js` extension in all relative imports: `import { Foo } from './bar.js'`
- Use `import type` for type-only imports
- Node builtins use `node:` prefix: `node:child_process`, `node:fs`

### TypeScript

- **Strict mode** — all strict flags enabled, plus `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
- **Target:** ES2024, **module:** ESNext, **moduleResolution:** bundler
- **No `as any` or `@ts-ignore`** — use proper generics
- **IDs are strings** — always `String(raw.id)`, even when APIs return numbers

### Provider method structure

Every public method follows this pattern:
```typescript
try {
  const data = await cachedFetch<RawType>(this.client, url);
  return mapFunction(data);
} catch (error) {
  throw normalizeError(error, 'platform');
}
```

### Mapper functions

Each provider defines raw API interfaces (snake_case) and mapper functions that convert to unified types (camelCase). Mappers are pure functions, not methods.

### Resource binding

Resources (repos, issues, etc.) are object literals bound in constructor, delegating to private methods.

### Auth headers

| Platform | Header | Format |
|----------|--------|--------|
| GitHub | `Authorization` | `token X` |
| GitLab | `Private-Token` | `X` |
| Gitea | `Authorization` | `token X` |

Configured via `tokenHeader`/`tokenPrefix` in `createHttpClient()`.

### Key rules

- **Token check:** use `!== undefined` not falsy check. Empty string is intentional (allow unauthenticated).
- **List vs Get:** list operations use `rawFetch` (need headers for pagination), get operations use `cachedFetch`.
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

vi.mock('../src/http.js', () => ({ createHttpClient: mocks.createHttpClient, rawFetch: mocks.rawFetch }));
vi.mock('../src/cache.js', () => ({ cachedFetch: mocks.cachedFetch }));
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
- Explain *why* for non-obvious decisions, skip the *what* when the diff speaks.
- No filler, no trailing summaries, no template prose.

## Platform-Specific Notes

- **GitBucket** works via GitHub provider with custom `baseURL` — no separate provider needed.
- **GitLab `/users/:owner/projects`** returns 404 for groups — `listRepos` falls back to `/groups/:owner/projects` only on 404, re-throws other errors.
- **GitHub `/issues` returns PRs** — filtered by absence of `pull_request` key.
- **GitLab uses `iid`** (project-scoped) not `id` (global) for issue/MR numbers.
- **Gitea uses `limit`** param, not `per_page`.
- **unstorage memory driver has no TTL** — that's why lru-cache driver is used.

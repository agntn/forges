# docs/

Docus site for `@agntn/forges`. Markdown lives in `content/`. The explorer is a Vue page in the Nuxt app backed by Nitro routes over the library, not a script.

## Layout

```
docs/
├── nuxt.config.ts                 # extends: ['docus'], cloudflare_module preset (Workers)
├── app/app.config.ts              # title, github, theme
├── app/app.css                    # theme tokens (light + .dark), shared `forges-*` classes
├── app/components/                # Docus overrides: AppHeaderLogo, AppHeaderCTA (nav), AppFooterLeft, DocsAsideLeftBody
├── app/components/content/        # MDC components (`::landing-home`, `::platform-facts`) and the landing panels
├── app/components/OgImage/        # Docs.takumi and Landing.takumi override the Docus OG templates
├── app/assets/fonts.css           # @font-face for the TTFs served from public/fonts (site and OG images)
├── app/composables/               # useLandingForge (one clock for every live panel), useSubNavigation
├── app/utils/                     # platforms table, formatting, recorded landing samples
├── app/pages/explorer.vue         # explorer, own route outside the docs layout
├── server/api/                    # repo, issues, pulls, commits, ci, threads, user, platforms over the library
├── server/utils/                  # forge.ts (one provider per platform), query.ts (caps, cache, rate limit, errors), slim.ts (wire shapes)
├── scripts/record-fixtures.mjs    # regenerates app/utils/landing-fixtures.ts through dist/
├── content/index.md               # landing
├── content/1.guide/               # getting started, auth, repositories, issues, pull requests, threads, commits, templates, code search, agents, custom, explorer
└── content/2.platforms/           # one page per platform
```

## Commands

```bash
pnpm install          # from docs/, after pnpm build in the repo root
pnpm dev              # http://localhost:3000
pnpm build            # Cloudflare Workers output in .output/, content routes prerendered
pnpm deploy           # build, then wrangler deploy to forges.agntn.dev
pnpm generate         # static output only, the /api routes need the worker
node scripts/record-fixtures.mjs   # record the landing samples again (needs gh logged in for GitHub threads)
```

Deployment: Nitro preset `cloudflare_module`. Nuxt Content needs a D1 binding named `DB` and the response cache a KV binding named `CACHE`. `wrangler.jsonc` carries both plus the `NUXT_SITE_URL` var, and Nitro merges it into the generated `.output/server/wrangler.json`. Create them once with `wrangler d1 create agntn-forges` and `wrangler kv namespace create CACHE` and put the ids in `wrangler.jsonc`. Until then the ids are all zeros on purpose, and `pnpm deploy` with zeros would bind nothing, so do not run it before they are replaced.

Platform tokens are Worker secrets, never vars: `wrangler secret put GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITEA_TOKEN`. With `nodejs_compat` the runtime exposes them on `process.env`, which is where `server/utils/forge.ts` reads them. A platform without a secret shows up as `authenticated: false` in `/api/platforms` and its reads go out anonymously: GitLab public projects except discussions and search, Gitea public repositories. GitHub anonymous is sixty requests an hour per address and Cloudflare egress addresses are shared, so from the worker it answers 429 almost always. Set `GITHUB_TOKEN` (a fine grained token with public read access is enough) or every GitHub tab in the explorer is a 429. An optional `FORGES_<PLATFORM>_BASE_URL` var points a platform at a self hosted instance.

The site imports `@agntn/forges` from `file:..`. Build the parent package first.

Resolution traps, both caused by the repo root being a pnpm workspace:

- `pnpm-workspace.yaml` sets `shamefullyHoist: true`. Without it `docs/node_modules` holds only direct dependencies, Node walks up to the root `node_modules`, and the server bundle can get a second copy of Vue.
- `nuxt.config.ts` pins `workspaceDir` to `docs/` and disables devtools and telemetry, which would otherwise be resolved from the root.

## Live data

- `server/utils/forge.ts` keeps one provider per platform and host for the worker's lifetime and always passes the token explicitly, the empty string when there is none, so the library never shells out to `gh` or `glab` on a Worker. A `host` off the allowlist (`gitea.com`, `codeberg.org`) is a 400, the worker is not a proxy. The library's own LRU is off, Nitro caches the whole answer instead.
- Every route goes through `cachedAnswer` in `server/utils/query.ts`: exact parameters as the key, fifteen minutes for a repository, ten for a list, thirty for a user, nothing for a thrown failure. Do not bypass it, anonymous GitHub reads share one rate limit per address and the whole page runs on it. A cache miss also counts against `RATE_LIMIT` (30 new requests a minute per address, 429 past it). Cache hits are free.
- Parameters are capped in `server/utils/query.ts` (names 100 chars, `perPage` 10, threads 5 per page). `readName` accepts letters, digits, dots, dashes and underscores only.
- Answers are cut to size in `server/utils/slim.ts` before they leave the worker: no issue bodies, comment bodies bounded to 400 characters, no emails, no avatar URLs of commenters, and `viewerPermission` dropped from a repository because it would describe the worker's own token, which is nobody's business.
- Library errors are mapped in `toHttpError`: `NotFoundError` 404, `AuthenticationError` 503, `PermissionError` 403, `RateLimitError` 429, other `ForgesError` 502. The message never repeats an endpoint, `failureText` keeps only the part before the first `:` or `[`.
- `app/utils/landing-fixtures.ts` holds answers recorded through the library so the landing paints before the worker answers. Regenerate it with `scripts/record-fixtures.mjs` over `dist/index.mjs`. Never edit the recorded text by hand, it drifts and nobody notices. GitLab threads stay empty in the sample because discussions need a token even on a public project.
- In production the cache lives in the KV binding `CACHE` (`$production.nitro.storage.cache`). Locally it is in memory.
- The explorer applies its deep link once after mount. A prerendered page hydrates with an empty query and Nuxt restores the address only afterwards, so reading `route.query` in setup gives you nothing.

## OG images

- `app/components/OgImage/Docs.takumi.vue` and `Landing.takumi.vue` override the Docus templates of the same name and are rendered by Takumi at build time. Takumi has no CSS variables, so the theme colours from `app.css` are repeated there as literals. Annoying, but that is what it is.
- nuxt-og-image does not see the faces `@nuxt/fonts` generates on this Nuxt version, but it parses `@font-face` rules from the files in `css`. That is why `app/assets/fonts.css` declares the five TTFs in `public/fonts` and `fonts.families` uses the `local` provider: the site and the OG images share the same files.
- The landing OG file is named from the SEO description. Nitro refuses to write a prerender path containing `..`, so a description ending in a period is silently skipped and the landing ships with a dead `og:image`. Keep the description in `content/index.md` without a trailing period. Silently is the bad part.

## Constraints

- Titles, labels, descriptions, commit messages and review comments are untrusted data. Render them as text through `plainText` or a `<pre>`. Never `v-html`, never evaluate, seriously.
- Platform names, icons, env vars, hosts and capability notes live once in `app/utils/platforms.ts`. The sidebar, the landing grid, the explorer and `::platform-facts` read from it, the auth columns mirror `src/auth.ts` on the library.
- Keep the docs API shapes (`RepoAnswer` and friends) in the route files and `server/utils/slim.ts`. The explorer mirrors them as local interfaces.
- Never commit a token, and never put one in `wrangler.jsonc` vars.

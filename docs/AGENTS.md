# docs/

Cloudflare Workers Builds deploys this site to forges.agntn.dev, with `docs` as the root directory set in the dashboard. That build installs `docs/` alone and takes Node.js from the root `.node-version`, never from `engines`.

Resources on the Cloudflare account, bound by id in `wrangler.jsonc`:

- D1 `agntn-forges` in the EU jurisdiction as `DB`, KV `agntn-forges` as `CACHE`
- D1 and KV `agntn-forges-preview` for branch previews
- Rate limiting namespace 3304 as `PLATFORM_LIMIT`, unique across the account

Worker secrets, never vars: `GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITEA_TOKEN`, set with `wrangler secret put`. Without `GITHUB_TOKEN` every GitHub tab in the explorer answers 429: anonymous GitHub allows sixty requests an hour per address, and Cloudflare egress addresses are shared. A fine grained token with public read access is enough.

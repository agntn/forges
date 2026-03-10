# Examples

This directory contains small runnable examples for common `gixa` workflows.

- `provider-basic.ts` - create providers and fetch repositories/issues
- `pagination-helpers.ts` - use exported pagination helpers with explicit limits and error handling

Run with your preferred TypeScript runner, for example:

```bash
pnpm dlx tsx examples/provider-basic.ts
pnpm dlx tsx examples/pagination-helpers.ts
```

Both examples call the GitHub API and can hit unauthenticated rate limits.
For higher limits, export `GITHUB_TOKEN` before running:

```bash
export GITHUB_TOKEN=your_token_here
```

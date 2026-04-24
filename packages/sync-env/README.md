# @utilities-studio/sync-env

Sync environment variables to Cloudflare Workers and Supabase Edge Functions.

- Reads decrypted `.env.{environment}` files
- Splits vars vs secrets (secrets contain `SECRET`, `API_KEY`, `TOKEN`, etc.)
- **Cloudflare**: writes vars to `wrangler.jsonc`, uploads secrets via `wrangler versions secret bulk`
- **Supabase**: auto-scans `Deno.env.get()` calls in edge functions, syncs only used secrets
- **Monorepo support**: auto-discovers `apps/*/wrangler.jsonc` when no root `wrangler.jsonc` exists

## Usage

```bash
# Single project -- sync to Cloudflare (development)
bunx @utilities-studio/sync-env cloudflare --env development

# Single project -- sync to Supabase (production)
bunx @utilities-studio/sync-env supabase --env production

# Single project -- sync both targets, both environments
bunx @utilities-studio/sync-env

# Monorepo -- auto-discovers apps/*/wrangler.jsonc, env files at root
bunx @utilities-studio/sync-env cloudflare --env development

# Monorepo -- env files in a different directory
bunx @utilities-studio/sync-env cloudflare --env development --env-dir ../..
```

## Monorepo Support

When no `wrangler.jsonc` exists at the current directory, sync-env automatically scans for `apps/*/wrangler.jsonc` (then `packages/*/wrangler.jsonc`). Each discovered config is synced independently -- vars written to its `wrangler.jsonc`, secrets pushed via `wrangler` from that directory.

Env files (`.env.development`, `.env.production`) are read from the current directory by default. Use `--env-dir` to specify a different location.

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `cloudflare` | Sync to Cloudflare Workers | Both targets |
| `supabase` | Sync to Supabase Edge Functions | Both targets |
| `--env <name>` | Target environment (development/production) | Both |
| `--env-dir <path>` | Directory containing `.env.*` files | Current directory |

## Requirements

- Bun runtime
- `.env.development` / `.env.production` files (decrypted)
- `wrangler.jsonc` in project root or `apps/*/wrangler.jsonc` (for Cloudflare)
- `supabase/functions/` directory (for Supabase)

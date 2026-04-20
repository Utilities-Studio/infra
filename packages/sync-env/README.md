# @utilities-studio/sync-env

Sync environment variables to Cloudflare Workers and Supabase Edge Functions.

- Reads decrypted `.env.{environment}` files
- Splits vars vs secrets (secrets contain `SECRET`, `API_KEY`, `TOKEN`, etc.)
- **Cloudflare**: writes vars to `wrangler.jsonc`, uploads secrets via `wrangler versions secret bulk`
- **Supabase**: auto-scans `Deno.env.get()` calls in edge functions, syncs only used secrets

## Usage

```bash
# Sync to Cloudflare (development)
bunx @utilities-studio/sync-env cloudflare --env development

# Sync to Supabase (production)
bunx @utilities-studio/sync-env supabase --env production

# Sync both targets, both environments
bunx @utilities-studio/sync-env
```

## Requirements

- Bun runtime
- `.env.development` / `.env.production` files (decrypted)
- `wrangler.jsonc` in project root (for Cloudflare)
- `supabase/functions/` directory (for Supabase)

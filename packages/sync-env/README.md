# @utilities-studio/sync-env

Sync environment variables to Cloudflare Workers and Supabase Edge Functions.

- Reads decrypted `.env.{environment}` files
- Splits vars vs secrets using a reusable env-key classifier
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

# Preview Cloudflare changes without writing wrangler.jsonc or pushing secrets
bunx @utilities-studio/sync-env cloudflare --dry-run

# Sync one discovered app config in a monorepo
bunx @utilities-studio/sync-env cloudflare --filter app-name

# Show help/version
bunx @utilities-studio/sync-env --help
bunx @utilities-studio/sync-env --version

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
| `--dry-run`, `-n` | Preview changes without writing files or pushing secrets | Off |
| `--filter <name>` | Restrict discovered Cloudflare configs by directory match | All configs |
| `--vars-only` | Write only Cloudflare vars to `wrangler.jsonc` | Off |
| `--secrets-only` | Push only Cloudflare secrets | Off |
| `--skip <KEY,...>` | Exclude additional Cloudflare keys | Built-in skip list |
| `--version` | Print package version | -- |

## Reusable secret detection

`sync-env` exports the same key classifier used by the CLI:

```ts
import { classifyEnvKey, hasPublicEnvMarker, isSecretKey } from '@utilities-studio/sync-env/secret-keys'

isSecretKey('AWS_SECRET_ACCESS_KEY') // true
isSecretKey('VITE_SUPABASE_PUBLISHABLE_KEY') // false
classifyEnvKey('PUBLIC_REFRESH_TOKEN')
// { isPublic: true, isSecret: true, reason: 'hard secret marker' }
```

Hard secret markers win over public markers. For example, `PUBLIC_REFRESH_TOKEN`
and `VITE_INTERNAL_SECRET` are still treated as secrets. Browser/public markers
include `VITE_`, `NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `PUBLIC_`, `EXPO_PUBLIC_`,
`REACT_APP_`, `PUBLISHABLE`, `PUBLIC_KEY`, and `SITE_KEY`.

Secret markers cover common credentials including `SECRET`, `TOKEN`, `API_KEY`,
`ACCESS_KEY`, `SERVICE_ROLE`, `PASSWORD`, database URLs, connection strings,
private keys, signing keys, encryption keys, HMAC keys, credentials, and
restricted keys.

## Requirements

- Bun runtime
- `.env.development` / `.env.production` files (decrypted)
- `wrangler.jsonc` in project root or `apps/*/wrangler.jsonc` (for Cloudflare)
- `supabase/functions/` directory (for Supabase)

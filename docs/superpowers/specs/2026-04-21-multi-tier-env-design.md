# Multi-Tier Environment Support

Support three env tiers across all infra tooling: no env (static sites), single env (`.env`), and multi env (`.env.development` + `.env.production`).

## Env Tier Detection

Auto-detect based on file existence in project root:

```
1. .env.development OR .env.production exists  -->  MULTI
2. .env exists                                  -->  SINGLE
3. neither                                      -->  NONE
```

Multi wins if both `.env` and `.env.development` exist.

Internal type: `type EnvTier = 'multi' | 'single' | 'none'`

Detection runs in two places:
- **sync-env** -- built-in TypeScript logic
- **Workflows** -- bash step early in job, sets `ENV_TIER` output

## Tier Behavior Summary

| Tier | Env files | GitHub secrets | Workflow `environment` input |
|---|---|---|---|
| **none** | -- | `CLOUDFLARE_API_TOKEN` | omitted |
| **single** | `.env` (encrypted) | `CLOUDFLARE_API_TOKEN`, `DOTENV_PRIVATE_KEY` | omitted |
| **multi** | `.env.development`, `.env.production` | `CLOUDFLARE_API_TOKEN`, `DOTENV_PRIVATE_KEY_DEVELOPMENT`, `DOTENV_PRIVATE_KEY_PRODUCTION` | `development` or `production` |

## Component Changes

### 1. sync-env

**Tier detection at startup:**

```typescript
type EnvTier = 'multi' | 'single' | 'none'

function detectTier(): EnvTier {
  // .env.development or .env.production exists --> multi
  // .env exists --> single
  // neither --> none
}
```

**Loading env files by tier:**

```typescript
function loadEnvFiles(tier: EnvTier): Record<string, Record<string, string>>
// multi:  { development: {...}, production: {...} }
// single: { root: {...} }
// none:   {}
```

The `root` key signals root-level wrangler config. `development`/`production` keys signal `env.*` blocks.

**Cloudflare sync by tier:**

| Tier | Public vars location | Secrets command |
|---|---|---|
| **none** | skip | skip |
| **single** | `wrangler.jsonc` root `vars` | `wrangler versions secret bulk {file}` (no `--env`) |
| **multi** | `wrangler.jsonc` `env.{name}.vars` | `wrangler versions secret bulk {file} --env {name}` |

**Supabase sync by tier:**

| Tier | Behavior |
|---|---|
| **none** | skip |
| **single** | read `.env`, sync secrets to project ref from `SUPABASE_PROJECT_ID` |
| **multi** | current behavior -- read `.env.{environment}` per env |

**`--env` flag behavior:**
- `--env development` or `--env production` -- force multi-env behavior
- No `--env` -- auto-detect tier
- `--env` passed but file doesn't exist -- **error** (explicit contract, missing file = broken)

**Exit behavior:**
- `NONE` tier with no `--env` flag -- exit 0 with message "No env files found, nothing to sync."
- `NONE` tier with `--env` flag -- error (file expected but missing)

### 2. cloudflare-deploy.yml

**New detect step** (runs after checkout):

```yaml
- name: Detect env tier
  id: env-tier
  run: |
    if [ -f .env.development ] || [ -f .env.production ]; then
      echo "tier=multi" >> "$GITHUB_OUTPUT"
    elif [ -f .env ]; then
      echo "tier=single" >> "$GITHUB_OUTPUT"
    else
      echo "tier=none" >> "$GITHUB_OUTPUT"
    fi
```

**New secret:** `DOTENV_PRIVATE_KEY` (no suffix) for single-env tier.

**Step behavior by tier:**

| Step | none | single | multi |
|---|---|---|---|
| DOTENV keys | not set | `DOTENV_PRIVATE_KEY` | `DOTENV_PRIVATE_KEY_{DEV\|PROD}` |
| sync-env | skipped (`skip_sync_env` or tier=none) | `sync-env cloudflare` (no `--env`) | `sync-env cloudflare --env {environment}` |
| build --mode | no mode flag | no mode flag | `--mode {environment}` |
| wrangler deploy | no `--env` | no `--env` | `--env {environment}` |
| preview upload | no `--env` | no `--env` | `--env development` |

**Env variable changes:**
- `ENV_FLAG` -- empty when tier is not multi
- `PREVIEW_ENV_FLAG` -- empty when tier is not multi
- `MODE_FLAG` -- empty when tier is not multi
- `DOTENV_PRIVATE_KEY` -- set from new secret when tier is single

### 3. cloudflare-pages-deploy.yml

**New detect step** (same as workers).

**New secret:** `DOTENV_PRIVATE_KEY` (no suffix).

**Step behavior by tier:**

| Step | none | single | multi |
|---|---|---|---|
| DOTENV keys | not set | `DOTENV_PRIVATE_KEY` | `DOTENV_PRIVATE_KEY_{DEV\|PROD}` |
| build --mode | `production` | `production` always (no dev/prod distinction) | preview=`development`, prod=`production` |

Single-env Pages: one set of vars, no distinction between preview and production build. Same `.env` used for both. Preview only differs in deploy branch (`--branch pr-{n}` vs `--branch main`).

### 4. supabase-deploy.yml

**`environment` input becomes optional** (default: `''`).

**New detect step** when environment is empty:

```yaml
- name: Detect env file
  if: inputs.environment == ''
  id: env-tier
  run: |
    if [ -f .env ]; then
      echo "env_file=.env" >> "$GITHUB_OUTPUT"
    else
      echo "No env file found" && exit 1
    fi
```

**Step behavior:**

| Step | no environment input (single) | environment input (multi) |
|---|---|---|
| env file | `.env` | `.env.{environment}` |
| DOTENV key | `DOTENV_PRIVATE_KEY` | `DOTENV_PRIVATE_KEY_{DEV\|PROD}` |
| load env vars | reads `.env` | reads `.env.{environment}` |
| supabase link | `--project-ref` from `.env` | same |
| sync-env | `sync-env supabase` (no `--env`) | `sync-env supabase --env {environment}` |
| deploy tag | `supabase-deploy-{timestamp}` | `supabase-deploy-{env}-{timestamp}` |

If `environment` empty AND `.env` doesn't exist -- fail.

### 5. vite-env

**Fallback chain:**

```
1. .env.development exists  -->  use it (current behavior)
2. .env exists              -->  use it
3. neither                  -->  skip (exit 0, "no env file found")
```

No other changes. Already exits gracefully when no `VITE_` vars found.

### 6. env-local

**No changes.** Generates `.env.development.local` from local Supabase. Works for all tiers -- local dev always uses development overlay.

## Non-Breaking Migration

Zero breaking changes. Existing behavior preserved:

- Multi-env callers keep passing `environment` input -- identical behavior
- New single-env callers opt in by not passing `environment` and having `.env`
- New no-env callers opt in by not having env files -- everything skips gracefully

## Files Changed

| File | Type of change |
|---|---|
| `packages/sync-env/src/index.ts` | Tier detection, single-env Cloudflare (root vars), single-env Supabase, graceful none exit |
| `packages/vite-env/src/index.ts` | Fallback to `.env` |
| `.github/workflows/cloudflare-deploy.yml` | Detect step, conditional flags/secrets, new `DOTENV_PRIVATE_KEY` secret |
| `.github/workflows/cloudflare-pages-deploy.yml` | Detect step, conditional dotenvx key, single-env mode handling |
| `.github/workflows/supabase-deploy.yml` | Optional `environment`, detect step, read `.env` fallback |

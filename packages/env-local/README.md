# @utilities-studio/env-local

Generate `.env.development.local` from a running local Supabase instance.

Reads `supabase status`, extracts connection details, and generates a local env file with Vite-compatible variables, Supabase credentials, and a derived webhook secret.

## Usage

```bash
# Requires local Supabase running (bunx supabase start)
bunx @utilities-studio/env-local
```

## Output

Creates `.env.development.local` with:
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL` / `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_URL`
- `SEND_EMAIL_HOOK_URI` / `SEND_EMAIL_HOOK_SECRET` (HMAC-derived from JWT secret)

## Requirements

- Bun runtime
- Local Supabase running (`bunx supabase start`)

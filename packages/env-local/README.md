# @utilities-studio/env-local

Generate matching local env overrides from a running local Supabase instance.

Reads `supabase status`, extracts connection details, and generates or updates a local env file with Vite-compatible variables, Supabase credentials, and a derived webhook secret.

## Usage

```bash
# Requires local Supabase running (bunx supabase start)
bunx @utilities-studio/env-local
bunx @utilities-studio/env-local --env-file .env
bunx @utilities-studio/env-local --env-dir ../..
```

## Output

Writes the local overlay that matches the project env file shape:

| Detected base file | Output file |
|---|---|
| `.env` | `.env.local` |
| `.env.development` | `.env.development.local` |
| no base env file | `.env.local` |

Use `--env-file <file>` to force a base file or `--output <file>` to force the exact destination.

When a base env file exists, `env-local` reads its variable names and generates only matching local override variables. For example, email hook variables are generated only when `SEND_EMAIL_HOOK_URI` or `SEND_EMAIL_HOOK_SECRET` exists in the base file.

When the output file already exists, `env-local` replaces only its generated local Supabase section and preserves user-created variables in a separate section at the bottom.

The generated variable set supports:

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL` / `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_URL`
- `SEND_EMAIL_HOOK_URI` / `SEND_EMAIL_HOOK_SECRET` (HMAC-derived from JWT secret)

## Requirements

- Bun runtime
- Local Supabase running (`bunx supabase start`)

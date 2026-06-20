# @utilities-studio/vite-env

Generate `vite-env.d.ts` type declarations from `VITE_` environment variables.

Scans `process.env` for all `VITE_` prefixed variables and generates a strict `ImportMetaEnv` interface.

## Usage

```bash
# Run with env file loaded
bun --env-file=.env.development bunx @utilities-studio/vite-env

# Write somewhere else or scan a different prefix
bun --env-file=.env.development bunx @utilities-studio/vite-env --out src/env.d.ts
bun --env-file=.env bunx @utilities-studio/vite-env --prefix PUBLIC_
bunx @utilities-studio/vite-env --version
```

## Output

Creates `src/vite-env.d.ts` with typed `ImportMetaEnv`:

```typescript
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SITE_URL: string
}
```

## Requirements

- Bun runtime
- `.env.development` or `.env` file in project root

# @utilities-studio/vite-env

Generate `vite-env.d.ts` type declarations from `VITE_` environment variables.

Scans `process.env` for all `VITE_` prefixed variables and generates a strict `ImportMetaEnv` interface.

## Usage

```bash
# Run with env file loaded
bun --env-file=.env.development bunx @utilities-studio/vite-env
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
- `.env.development` file in project root

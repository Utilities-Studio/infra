# @utilities-studio/env-encrypt

Fast dotenvx compare-and-encrypt CLI for pre-commit hooks.

It checks the env files that exist in the target directory:

- `.env`
- `.env.development`
- `.env.production`

For each plaintext file, it compares parsed key/value pairs against the matching encrypted file:

- `.env.encrypted`
- `.env.development.encrypted`
- `.env.production.encrypted`

If values drift, it prints only the key names and re-encrypts only the changed files.

## Usage

```bash
bunx @utilities-studio/env-encrypt
```

Stage changed encrypted files for a git hook:

```bash
bunx @utilities-studio/env-encrypt --stage
```

Check only and fail when encrypted files are out of date:

```bash
bunx @utilities-studio/env-encrypt --check
```

Use env files from another directory:

```bash
bunx @utilities-studio/env-encrypt --env-dir ../..
```

## Output

Secret values are never printed.

```text
.env.development changed:
  STRIPE_SECRET_KEY changed
  SUPABASE_URL added

encrypted .env.development.encrypted
```

If nothing changed:

```text
env-encrypt: encrypted env files are current.
```

## Husky

```sh
# .husky/pre-commit
bunx @utilities-studio/env-encrypt --stage
```


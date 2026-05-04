<p align="center">
  <h1 align="center">Utilities Studio Infra</h1>
  <p align="center">
    <strong>Reusable CLI tools and GitHub Actions workflows for environment management, deployment, and Stripe sync.</strong>
  </p>
  <p align="center">
    The infrastructure layer behind every <a href="https://github.com/Utilities-Studio">Utilities Studio</a> project.
  </p>
  <p align="center">
    <code>5 packages</code> &middot; <code>8 workflows</code> &middot; <code>3 platforms</code> &middot; <code>zero config</code>
  </p>
</p>

<p align="center">
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-000000?style=flat-square&logo=bun&logoColor=white" alt="Bun"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://workers.cloudflare.com"><img src="https://img.shields.io/badge/Cloudflare_Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Workers"></a>
  <a href="https://pages.cloudflare.com"><img src="https://img.shields.io/badge/Cloudflare_Pages-F38020?style=flat-square&logo=cloudflarepages&logoColor=white" alt="Cloudflare Pages"></a>
  <a href="https://supabase.com"><img src="https://img.shields.io/badge/Supabase-3FCF8E?style=flat-square&logo=supabase&logoColor=white" alt="Supabase"></a>
  <a href="https://stripe.com"><img src="https://img.shields.io/badge/Stripe-635BFF?style=flat-square&logo=stripe&logoColor=white" alt="Stripe"></a>
  <a href="https://github.com/features/actions"><img src="https://img.shields.io/badge/GitHub_Actions-2088FF?style=flat-square&logo=githubactions&logoColor=white" alt="GitHub Actions"></a>
  <a href="https://www.npmjs.com/org/utilities-studio"><img src="https://img.shields.io/badge/npm-CB3837?style=flat-square&logo=npm&logoColor=white" alt="npm"></a>
</p>

---

```
+--------------------------------------------------------------------------+
|                                                                          |
|   One monorepo. Four npm packages. Eight reusable workflows.             |
|                                                                          |
|   Sync env vars. Deploy Workers. Deploy Pages. Deploy Supabase.          |
|   Push Stripe config. Pull to Supabase. Auto-publish on change.          |
|   AI-powered code review on every PR.                                    |
|                                                                          |
|   Call a workflow. Pass your secrets. Ship.                               |
|                                                                          |
+--------------------------------------------------------------------------+
```

---

## Packages

All published to npm under `@utilities-studio/`. Install nothing -- use `bunx` directly.

| Package | Version | What it does |
|---|---|---|
| [`sync-env`](packages/sync-env/) | 1.1.0 | Sync `.env.*` files to Cloudflare Workers and Supabase Edge Functions |
| [`env-encrypt`](packages/env-encrypt/) | 1.0.0 | Encrypt changed dotenvx env files only when plaintext values drift |
| [`stripe-sync`](packages/stripe-sync/) | 1.0.1 | Push products/prices to Stripe, pull to Supabase, manage webhooks |
| [`vite-env`](packages/vite-env/) | 1.0.1 | Generate typed `vite-env.d.ts` from `VITE_*` environment variables |
| [`env-local`](packages/env-local/) | 1.0.1 | Generate `.env.development.local` from a running local Supabase instance |

---

## sync-env

Reads decrypted `.env.*` files, splits vars from secrets, and pushes them where they belong.

```
  .env.development                .env.production
        |                               |
        v                               v
  +-----------+                   +-----------+
  | sync-env  |                   | sync-env  |
  +-----+-----+                   +-----+-----+
        |                               |
   +----+----+                     +----+----+
   |         |                     |         |
   v         v                     v         v
 wrangler  supabase              wrangler  supabase
  .jsonc   functions              .jsonc   functions
 (vars)   (secrets)              (vars)   (secrets)
```

**Smart secret detection** -- variables matching `SECRET`, `API_KEY`, `TOKEN`, `PASSWORD`, `PRIVATE` patterns are separated and uploaded as secrets. Everything else goes to `wrangler.jsonc` as plain vars.

**Monorepo support** -- when no root `wrangler.jsonc` exists, auto-discovers `apps/*/wrangler.jsonc` and `packages/*/wrangler.jsonc`. Each target synced independently.

**Env tier detection** -- automatically detects single-tier (`.env`) or multi-tier (`.env.development` / `.env.production`) setups.

```bash
bunx @utilities-studio/sync-env                                  # both targets, both envs
bunx @utilities-studio/sync-env cloudflare --env development     # just Cloudflare, just dev
bunx @utilities-studio/sync-env supabase --env production        # just Supabase, just prod
bunx @utilities-studio/sync-env cloudflare --env-dir ../..       # monorepo: env files at root
```

---

## env-encrypt

Fast dotenvx guard for pre-commit hooks. It checks `.env`, `.env.development`, and `.env.production` when they exist, compares parsed key/value maps against the matching `.encrypted` file, prints only changed key names, and encrypts only files that drifted.

```bash
bunx @utilities-studio/env-encrypt
bunx @utilities-studio/env-encrypt --stage
bunx @utilities-studio/env-encrypt --check
bunx @utilities-studio/env-encrypt --env-dir ../..
```

Output never prints secret values:

```text
.env.development changed:
  STRIPE_SECRET_KEY changed
  SUPABASE_URL added
```

Use `--stage` in Husky hooks when encrypted files must be added back to the current commit:

```sh
bunx @utilities-studio/env-encrypt --stage
```

When `CI=true` or `GITHUB_ACTIONS=true`, `--stage` exits successfully without scanning or encrypting, so Husky hooks do not need a separate CI guard.

---

## stripe-sync

Declarative Stripe management. Define products/prices in JSON, sync bidirectionally.

```bash
# Push products + prices from config to Stripe
bunx @utilities-studio/stripe-sync push ./scripts/stripe-config.json

# Dry run -- see what would change without touching Stripe
bunx @utilities-studio/stripe-sync push ./scripts/stripe-config.json --dry

# Pull products + prices from Stripe into Supabase
bunx @utilities-studio/stripe-sync pull

# Create or update webhook endpoint
bunx @utilities-studio/stripe-sync webhook ./scripts/stripe-config.json
```

Config lives in your project as `scripts/stripe-config.json`:

```json
{
  "products": [
    {
      "name": "Pro",
      "features": ["Unlimited seats", "Priority support"],
      "prices": [
        { "amount": 2900, "interval": "month", "lookupKey": "pro_monthly" },
        { "amount": 27800, "interval": "year", "lookupKey": "pro_yearly" }
      ]
    }
  ],
  "webhookEvents": ["checkout.session.completed", "customer.subscription.updated"]
}
```

Supports recurring prices, one-time prices, product features, metadata, and custom webhook URLs for non-Supabase projects.

---

## vite-env

One command. Typed environment variables.

```bash
bun --env-file=.env.development bunx @utilities-studio/vite-env
```

Scans `process.env` for `VITE_*` variables and generates `src/vite-env.d.ts`:

```typescript
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SITE_URL: string
}
```

Falls back from `.env.development` to `.env` if the development file doesn't exist.

---

## env-local

Bootstrap local Supabase credentials with zero manual copying.

```bash
bunx @utilities-studio/env-local
```

Reads `supabase status`, extracts all connection details, derives an HMAC-SHA256 webhook secret from the JWT secret, and writes `.env.development.local` with:

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` / `VITE_SITE_URL`
- `SUPABASE_URL` / `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_URL`
- `SEND_EMAIL_HOOK_URI` / `SEND_EMAIL_HOOK_SECRET`

Requires a running local Supabase instance (`bunx supabase start`).

---

## Workflows

All workflows are reusable (`workflow_call`). Call them from any repo.

```
  your-repo/.github/workflows/deploy.yml
       |
       |  uses: Utilities-Studio/infra/.github/workflows/cloudflare-deploy.yml@main
       |
       v
  This repo does the work
```

### Deployment

| Workflow | Target | PR Previews | Cleanup |
|---|---|---|---|
| [`cloudflare-deploy`](.github/workflows/cloudflare-deploy.yml) | Cloudflare Workers | Version preview with alias URL | Auto-expires |
| [`cloudflare-pages-deploy`](.github/workflows/cloudflare-pages-deploy.yml) | Cloudflare Pages | Branch deploy with preview URL | Manual via cleanup workflow |
| [`supabase-deploy`](.github/workflows/supabase-deploy.yml) | Supabase (migrations + edge functions) | -- | -- |

All deployment workflows:
- Detect env tier automatically (single vs multi)
- Decrypt env files via dotenvx
- Post deployment status as PR comments
- Gate production deploys behind GitHub environments

### Cleanup

| Workflow | What it does |
|---|---|
| [`cloudflare-pages-cleanup`](.github/workflows/cloudflare-pages-cleanup.yml) | Deletes Cloudflare Pages preview deployments when PR closes |
| [`cloudflare-workers-cleanup`](.github/workflows/cloudflare-workers-cleanup.yml) | Updates PR comment when Workers preview expires |

### CI / Release

| Workflow | What it does |
|---|---|
| [`release-package`](.github/workflows/release-package.yml) | Auto-detects changed packages, bumps patch version, publishes to npm, creates git tags |
| [`claude`](.github/workflows/claude.yml) | Claude Code agent -- responds to `@claude` mentions on issues and PRs |
| [`claude-code-review`](.github/workflows/claude-code-review.yml) | Automated PR code review -- updates titles, posts inline suggestions |

---

## Calling a Workflow

### Cloudflare Workers

```yaml
name: Deploy
on:
  push:
    branches: [main]
  pull_request:

jobs:
  deploy:
    uses: Utilities-Studio/infra/.github/workflows/cloudflare-deploy.yml@main
    with:
      working_directory: "."
    secrets:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      DOTENV_PRIVATE_KEY_PRODUCTION: ${{ secrets.DOTENV_PRIVATE_KEY_PRODUCTION }}
      DOTENV_PRIVATE_KEY_DEVELOPMENT: ${{ secrets.DOTENV_PRIVATE_KEY_DEVELOPMENT }}
```

### Cloudflare Pages

```yaml
jobs:
  deploy:
    uses: Utilities-Studio/infra/.github/workflows/cloudflare-pages-deploy.yml@main
    with:
      project_name: "my-app"
      account_id: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
      build_output_directory: "dist"
    secrets:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      DOTENV_PRIVATE_KEY_PRODUCTION: ${{ secrets.DOTENV_PRIVATE_KEY_PRODUCTION }}
```

### Supabase

```yaml
jobs:
  deploy:
    uses: Utilities-Studio/infra/.github/workflows/supabase-deploy.yml@main
    with:
      environment: "production"
      deploy_migrations: true
      deploy_functions: true
    secrets:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      DOTENV_PRIVATE_KEY_PRODUCTION: ${{ secrets.DOTENV_PRIVATE_KEY_PRODUCTION }}
```

### Claude Code Review

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    uses: Utilities-Studio/infra/.github/workflows/claude-code-review.yml@main
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

---

## How It All Fits Together

```
  Developer pushes code
       |
       v
  GitHub Actions triggers
       |
       +--- cloudflare-deploy -----> Cloudflare Workers
       |         |
       |         +--- sync-env ----> Secrets + vars synced
       |         +--- vite-env ----> Types generated
       |
       +--- cloudflare-pages ------> Cloudflare Pages
       |
       +--- supabase-deploy -------> Migrations + Edge Functions
       |         |
       |         +--- sync-env ----> Edge function secrets synced
       |
       +--- claude-code-review ----> AI reviews the PR
       |
       +--- release-package -------> Changed packages published to npm
       |
       v
  PR comment with deploy preview URL
```

---

## Project Structure

```
infra/
├── packages/
│   ├── sync-env/              Sync env vars to Cloudflare + Supabase
│   │   ├── src/index.ts
│   │   └── package.json
│   ├── env-encrypt/           Compare and encrypt dotenvx env files
│   │   ├── src/index.ts
│   │   └── package.json
│   ├── stripe-sync/           Stripe <-> Supabase product sync
│   │   ├── src/
│   │   │   ├── index.ts       CLI router (push | pull | webhook)
│   │   │   ├── push.ts        Config -> Stripe
│   │   │   ├── pull.ts        Stripe -> Supabase
│   │   │   ├── webhook.ts     Webhook endpoint management
│   │   │   └── types.ts       Config interfaces
│   │   └── package.json
│   ├── vite-env/              Generate typed VITE_* declarations
│   │   ├── src/index.ts
│   │   └── package.json
│   └── env-local/             Local Supabase -> .env.development.local
│       ├── src/index.ts
│       └── package.json
├── .github/workflows/
│   ├── cloudflare-deploy.yml         Workers deploy + PR previews
│   ├── cloudflare-pages-deploy.yml   Pages deploy + PR previews
│   ├── cloudflare-pages-cleanup.yml  Clean up Pages previews on PR close
│   ├── cloudflare-workers-cleanup.yml Update Workers preview status
│   ├── supabase-deploy.yml           Migrations + edge functions
│   ├── release-package.yml           Auto-publish changed packages
│   ├── claude.yml                    Claude Code agent integration
│   └── claude-code-review.yml        AI-powered PR review
└── docs/
    └── superpowers/                  Design specs and implementation plans
```

---

## Requirements

- [Bun](https://bun.sh) runtime (all packages use `#!/usr/bin/env bun`)
- Cloudflare account + API token (for deploy workflows)
- Supabase project (for Supabase workflows and stripe-sync pull)
- Stripe secret key (for stripe-sync)
- [dotenvx](https://dotenvx.com) encrypted env files (for CI workflows)

---

## Author

**Hariom Sharma** -- [github.com/harryy2510](https://github.com/harryy2510)

## License

MIT

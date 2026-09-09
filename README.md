<p align="center">
  <h1 align="center">Utilities Studio Infra</h1>
  <p align="center">
    <strong>Reusable CLI tools and GitHub Actions workflows for environment management, deployment, and Stripe sync.</strong>
  </p>
  <p align="center">
    The infrastructure layer behind every <a href="https://github.com/Utilities-Studio">Utilities Studio</a> project.
  </p>
  <p align="center">
    <code>7 packages</code> &middot; <code>7 workflows</code> &middot; <code>3 platforms</code>
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
|   Seven npm packages. Seven GitHub Actions workflows.                   |
|                                                                          |
|   Sync env vars. Deploy Workers. Deploy Pages. Deploy Supabase.          |
|   Push Stripe config. Pull to Supabase. Changesets releases.             |
|   Configure trusted publishing once. Publish through OIDC.               |
|                                                                          |
+--------------------------------------------------------------------------+
```

---

## Packages

Package sources live under `@utilities-studio/`. Published versions can be run directly with `bunx`.

| Package | Source version | What it does |
|---|---|---|
| [`sync-env`](packages/sync-env/) | 1.1.6 | Sync `.env.*` files to Cloudflare Workers and Supabase Edge Functions |
| [`env-encrypt`](packages/env-encrypt/) | 1.0.6 | Encrypt changed dotenvx env files only when plaintext values drift |
| [`github-env`](packages/github-env/) | 1.0.1 | Load dotenv files into GitHub Actions env and explicit step outputs |
| [`stripe-sync`](packages/stripe-sync/) | 1.0.4 | Push products/prices to Stripe, pull to Supabase, manage webhooks |
| [`vite-env`](packages/vite-env/) | 1.0.3 | Generate typed `vite-env.d.ts` from `VITE_*` environment variables |
| [`env-local`](packages/env-local/) | 1.0.3 | Generate matching local env overrides from a running local Supabase instance |
| [`npm-trust`](packages/npm-trust/) | 1.0.0 | Discover publishable packages and configure npm trusted publishing safely |

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

**Smart secret detection** -- variables are classified by the reusable `@utilities-studio/sync-env/secret-keys` helper. Browser/public markers such as `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_`, `PUBLISHABLE`, `PUBLIC_KEY`, and `SITE_KEY` stay as vars unless they also contain a hard secret marker. Credentials such as `SECRET`, `TOKEN`, `API_KEY`, `ACCESS_KEY`, `SERVICE_ROLE`, database URLs, connection strings, private keys, signing keys, encryption keys, HMAC keys, passwords, and restricted keys are uploaded as secrets.

**Monorepo support** -- when no root `wrangler.jsonc` exists, auto-discovers `apps/*/wrangler.jsonc` and `packages/*/wrangler.jsonc`. Each target synced independently.

**Env tier detection** -- automatically detects single-tier (`.env`) or multi-tier (`.env.development` / `.env.production`) setups.

```bash
bunx @utilities-studio/sync-env                                  # both targets, both envs
bunx @utilities-studio/sync-env cloudflare --env development     # just Cloudflare, just dev
bunx @utilities-studio/sync-env supabase --env production        # just Supabase, just prod
bunx @utilities-studio/sync-env cloudflare --env-dir ../..       # monorepo: env files at root
bunx @utilities-studio/sync-env cloudflare --dry-run --filter app
bunx @utilities-studio/sync-env --help
bunx @utilities-studio/sync-env --version
```

`sync-env` also supports `--vars-only`, `--secrets-only`, and `--skip <KEY,...>` for Cloudflare-specific control.

---

## env-encrypt

Fast dotenvx guard for pre-commit hooks. It checks `.env`, `.env.development`, and `.env.production` when they exist, compares parsed key/value maps against the matching `.encrypted` file, prints only changed key names, and encrypts only files that drifted.

```bash
bunx @utilities-studio/env-encrypt
bunx @utilities-studio/env-encrypt --stage
bunx @utilities-studio/env-encrypt --check
bunx @utilities-studio/env-encrypt --env-dir ../..
bunx @utilities-studio/env-encrypt --files .env,.env.preview --quiet
bunx @utilities-studio/env-encrypt --version
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

## github-env

Load dotenv files into GitHub Actions `$GITHUB_ENV` and explicit step outputs.

```bash
bunx @utilities-studio/github-env --environment production
bunx @utilities-studio/github-env --environment production --outputs AWS_REGION,AWS_ACCOUNT_ID
bunx @utilities-studio/github-env --env-file config/smoke.env --outputs AWS_REGION
bunx @utilities-studio/github-env --env-dir apps/web --environment development --outputs VITE_SITE_URL
```

By default, `github-env` writes all parsed application keys to `$GITHUB_ENV` and
writes no `$GITHUB_OUTPUT` values. Outputs are allow-listed with `--outputs`, and
output names are lowercased (`AWS_REGION` becomes `aws_region`).

```yaml
- name: Load smoke env
  id: smoke-env
  run: >
    bunx @utilities-studio/github-env
    --environment "${{ inputs.environment }}"
    --outputs AWS_REGION,AWS_ACCOUNT_ID,VITE_MCP_URL,VITE_SITE_URL
```

The CLI parses dotenv content as data, ignores dotenvx metadata keys, and fails
closed for GitHub-reserved keys such as `GITHUB_*`, `RUNNER_*`, `ACTIONS_*`, and
`NODE_OPTIONS`.

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

# Pull into Supabase stripe-sync-engine mirror tables
bunx @utilities-studio/stripe-sync pull --target=stripe-sync-engine

# Create or update webhook endpoint
bunx @utilities-studio/stripe-sync webhook ./scripts/stripe-config.json

# Help and version
bunx @utilities-studio/stripe-sync --help
bunx @utilities-studio/stripe-sync --version
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
bun --env-file=.env.development bunx @utilities-studio/vite-env --out src/env.d.ts
bun --env-file=.env bunx @utilities-studio/vite-env --prefix PUBLIC_
bunx @utilities-studio/vite-env --version
```

Scans `process.env` for `VITE_*` variables and generates `src/vite-env.d.ts`:

```typescript
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SITE_URL: string;
}
```

Falls back from `.env.development` to `.env` if the development file doesn't exist.

---

## env-local

Bootstrap local Supabase credentials with zero manual copying.

```bash
bunx @utilities-studio/env-local
bunx @utilities-studio/env-local --print
bunx @utilities-studio/env-local --force
bunx @utilities-studio/env-local --version
```

Reads `supabase status`, extracts all connection details, derives an HMAC-SHA256 webhook secret from the JWT secret, and writes the matching local overlay:

- `.env` -> `.env.local`
- `.env.development` -> `.env.development.local`
- no base env file -> `.env.local`

Use `--env-file <file>` to force a base file or `--output <file>` to force the exact destination.

When a base env file exists, `env-local` reads its variable names and generates only matching local override variables. For example, email hook variables are generated only when `SEND_EMAIL_HOOK_URI` or `SEND_EMAIL_HOOK_SECRET` exists in the base file.

When the output file already exists, `env-local` replaces only its generated local Supabase section and keeps user-created variables in a separate preserved section at the bottom.

The generated variable set supports:

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` / `VITE_SITE_URL`
- `SUPABASE_URL` / `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_URL`
- `SEND_EMAIL_HOOK_URI` / `SEND_EMAIL_HOOK_SECRET`

Requires a running local Supabase instance (`bunx supabase start`).

---

## npm-trust

Configure npm trusted publishing for every non-private publishable package in a normal repository or declared monorepo.

```bash
# Authenticated read-only preflight and plan
bunx @utilities-studio/npm-trust github \
  --repo utilities-studio/lena \
  --file publish.yml \
  --env npm-publish \
  --allow-publish

# Create missing configurations and replace differing records
bunx @utilities-studio/npm-trust github \
  --repo utilities-studio/lena \
  --file publish.yml \
  --env npm-publish \
  --allow-publish \
  --apply
```

The CLI validates the complete batch before writing and skips matching existing records. npm-added staged-publish access is accepted for `--allow-publish`; stage-only requests still reject direct-publish access. With `--apply`, it creates missing configurations and replaces differing records by revoking their IDs and creating the requested configuration. If replacement creation fails, rerun the same command to restore the missing configuration. Initial setup requires existing npm packages, an authenticated maintainer with write access, account-level 2FA, and npm >=11.15.0 and <13.0.0. GitHub Actions publishing uses OIDC afterward and needs no npm token.

See [`packages/npm-trust/README.md`](packages/npm-trust/README.md) for the bootstrap boundary and full contract.

---

## Workflows

Shared workflows use `workflow_call`. Infra's `release-package.yml` calls `npm-publish.yml` for installation, verification, Changesets version PRs, and OIDC publishing across all seven packages.

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
| [`supabase-deploy`](.github/workflows/supabase-deploy.yml) | Supabase (migrations + optional seeds + edge functions) | -- | -- |

All deployment workflows:

- Detect Infisical (OIDC) or dotenvx, then write `.env` / `.env.development` / `.env.production`
- Detect env tier automatically (single vs multi) from those files
- Restore Bun's global dependency cache from the caller's lockfile, then run `bun ci`
- Post deployment status as PR comments
- Gate production deploys behind GitHub environments

`with:` is deploy config only (`environment`, `working_directory`, `skip_build`, …). Infisical and dotenvx credentials are job env, not workflow inputs.

Reusable workflows copy caller repo `vars` / `secrets` into env:

- `INFISICAL_IDENTITY_ID`, `INFISICAL_PROJECT_SLUG`, `INFISICAL_DOMAIN` (required for Infisical; no Cloud default), `INFISICAL_ENV_SLUG`, `INFISICAL_SECRET_PATH`, `INFISICAL_RECURSIVE`
- `DOTENV_PRIVATE_KEY`, `DOTENV_PRIVATE_KEY_DEVELOPMENT`, `DOTENV_PRIVATE_KEY_PRODUCTION`
- `CLOUDFLARE_API_TOKEN` on Cloudflare jobs

Env files are created by [`.github/actions/ensure-env-files`](.github/actions/ensure-env-files/action.yml) after `bun ci`:

1. **Infisical** if both `INFISICAL_IDENTITY_ID` and `INFISICAL_PROJECT_SLUG` are set (GitHub OIDC; caller must grant `id-token: write`). Identity alone does not enable Infisical. GitHub `environment` `development`/`production` → Infisical env of the same name and `.env.{environment}`. No `environment` → Infisical `production` and `.env`.
2. **dotenvx** if `.env*.encrypted` files exist
3. **existing** if plaintext `.env*` files are already present
4. **none** otherwise (sync/build skip as today)

Later steps still read `.env`, `.env.development`, or `.env.production`. Infisical folder defaults to `/`.

Reusable workflows do not inherit caller `env:`. A one-project repo can set the Infisical GitHub vars and keep using `uses: …/cloudflare-deploy.yml@main`. For a different Infisical project on one job, call [`.github/actions/cloudflare-deploy`](.github/actions/cloudflare-deploy/action.yml) from a normal job and set `INFISICAL_*` in that job's `env`.

The Cloudflare Workers and Supabase workflows also accept `post_deploy_commands` for trusted, static
caller-owned commands that must run in the same environment job after a successful deploy. Cloudflare preview
deploys never run the hook. Do not interpolate pull request titles, branch names, or other untrusted event data
into this input.

### Cleanup

| Workflow | What it does |
|---|---|
| [`cloudflare-pages-cleanup`](.github/workflows/cloudflare-pages-cleanup.yml) | Deletes Cloudflare Pages preview deployments when PR closes |
| [`cloudflare-workers-cleanup`](.github/workflows/cloudflare-workers-cleanup.yml) | Updates PR comment when Workers preview expires |

### CI / Release

| Workflow | What it does |
|---|---|
| [`npm-publish`](.github/workflows/npm-publish.yml) | Reusable Changesets version PRs, changelogs, tags, and npm publishing through GitHub OIDC |
| [`release-package`](.github/workflows/release-package.yml) | Calls npm-publish for every public workspace package, including npm-trust |

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

Set GitHub vars `INFISICAL_IDENTITY_ID` and `INFISICAL_PROJECT_SLUG` (optional `INFISICAL_DOMAIN`) to use Infisical instead of dotenvx on that reusable job.

Per-job Infisical project (reusable workflows do not inherit caller `env:`):

```yaml
jobs:
  deploy-directus:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      id-token: write
    env:
      INFISICAL_IDENTITY_ID: ${{ vars.INFISICAL_IDENTITY_ID }}
      INFISICAL_PROJECT_SLUG: my-directus-project
      INFISICAL_DOMAIN: https://infisical.example.com
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    steps:
      - uses: Utilities-Studio/infra/.github/actions/cloudflare-deploy@main
        with:
          environment: production
          working_directory: containers/directus
          install_directory: .
          skip_build: true
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
      deploy_seeds: false
      deploy_functions: true
      skip_project_config_push: false
    secrets:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      DOTENV_PRIVATE_KEY_PRODUCTION: ${{ secrets.DOTENV_PRIVATE_KEY_PRODUCTION }}
```

Set `skip_project_config_push: true` when a project should deploy migrations or functions without running `supabase config push --yes`.

### npm Publishing

```yaml
# .github/workflows/publish.yml
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions: {}

jobs:
  publish:
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    uses: Utilities-Studio/infra/.github/workflows/npm-publish.yml@<full-commit-sha>
```

Pin the reusable workflow to a full commit SHA. This works for a single-package repository or a declared monorepo using Changesets CLI v3. The default branch must match the caller's trigger. The called job uses the caller repository's `npm-publish` environment. Create and protect that environment, restrict it to the default branch, and enable **Settings > Actions > General > Allow GitHub Actions to create and approve pull requests** before the first release.

npm trust remains tied to the caller repository and caller workflow filename, not the shared implementation. For Infra, trust `Utilities-Studio/infra`, `release-package.yml`, and environment `npm-publish`. For Lena's `publish.yml` caller, trust `utilities-studio/lena`, `publish.yml`, and the same environment name. The workflow needs no npm token. GitHub's automatic token creates the version PR and release tags.

The caller provides these root scripts:

| Script | Responsibility |
|---|---|
| `check` | Typecheck, build publishable artifacts, and run tests |
| `release:version` | `changeset version`, then update the package manager's lockfile |
| `release:publish` | `changeset publish` |

Optional workflow inputs are `working_directory`, `bun_version`, `install_command`, `verify_command`, `version_command`, and `publish_command`. Defaults use Bun and the scripts above. Override installation and lockfile handling for npm, pnpm, or Yarn callers. Keep command inputs static and repository-owned. Publish commands must invoke Changesets CLI v3 and preserve its `CHANGESETS_OUTPUT` environment variable so the action can create release tags and GitHub releases.

GitHub's automatic token does not trigger ordinary PR workflows when it opens the version PR. Run required checks manually on that PR if branch protection requires them. Environment reviewers also approve version-PR runs because versioning and publishing share the protected job.

### Releasing Infra packages

Infra is one Bun workspace with one root `bun.lock`. Install and verify from the root:

```bash
bun install --frozen-lockfile --ignore-scripts
bun run check
```

For each releasable change:

```bash
bun run changeset
```

Select the affected packages and bump levels. Commit the generated changeset with the change. After it reaches `main`, Changesets opens or updates **Version Packages**. Review and merge that PR; the next run publishes unpublished versions and creates package tags and GitHub releases. `workflow_dispatch` retries the same process without inventing another version bump.

Changesets owns package discovery, semantic versions, changelogs, and internal dependency updates. Adding a public package under `packages/*` requires no workflow edit. Public packages need `publishConfig.access: "public"` and correct repository metadata. Do not add package-specific release workflows, automatic patch comparisons, or per-package lockfiles.

Before enabling this flow:

1. Align source versions with any versions previously published by the old workflow, which bumped versions without committing them. Do not guess or reset versions.
2. Manually publish the first version of any package that does not yet exist on npm. [npm-trust's bootstrap instructions](packages/npm-trust/README.md#bootstrap-this-package) cover the new package.
3. Configure every package to trust the common caller. Run npm-trust with `--apply` to replace existing records that have a different repository, workflow, environment, or permissions.

From the Infra root, preview the authenticated trust plan, then repeat with `--apply` after reviewing it:

```bash
bun --no-env-file packages/npm-trust/src/index.ts github \
  --repo Utilities-Studio/infra \
  --file release-package.yml \
  --env npm-publish \
  --allow-publish
```

Never use a successful local check or dry run as evidence that npm OIDC publishing works. A real owner-authorized publication is required. See [Changesets automation](https://changesets.dev/guide/automating) for the upstream release model.

Run `bun --no-env-file run lint` from the root for type-aware Oxlint across all packages, tests, and GitHub scripts. The command enables `--type-check` to report compiler diagnostics alongside lint rules. `bun --no-env-file run check` runs lint, package builds, and tests in order. sync-env uses tsdown to build its ESM and CommonJS exports and generate declarations with TypeScript 7.

Migration verification, 2026-09-09: a fresh frozen-lockfile installation, root type-aware lint, and 15 focused release, package-export, and pure helper tests pass with tsdown 0.23.0 and TypeScript 7.0.2. The package tests rebuild and verify ESM, CommonJS, and both declaration files in the clean installation. Lint reports existing-test `await-thenable` warnings; tsdown marks its TypeScript 7 declaration generator as experimental. The full check gate, environment-file and infrastructure tests, GitHub execution, npm authentication, and publishing were not run. The release gate must pass before publishing.

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
       +--- release-package -------> npm-publish reusable workflow
                                     Changeset -> version PR -> merge -> OIDC publish
       |
       v
  PR comment with deploy preview URL
```

---

## Project Structure

```
infra/
├── package.json              Private Bun workspace and release scripts
├── bun.lock                  Shared dependency lockfile
├── tsconfig.json             Workspace-wide type information for Oxlint
├── .changeset/               Changesets config and pending release notes
├── packages/
│   ├── sync-env/              Sync env vars to Cloudflare + Supabase
│   │   ├── src/index.ts
│   │   └── package.json
│   ├── env-encrypt/           Compare and encrypt dotenvx env files
│   │   ├── src/index.ts
│   │   └── package.json
│   ├── github-env/            Load env files into GitHub Actions command files
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
│   ├── env-local/             Local Supabase -> matching local env overlay
│   │   ├── src/index.ts
│   │   └── package.json
│   └── npm-trust/             Configure npm trusted publishing in bulk
│       ├── src/
│       └── package.json
├── .github/workflows/
│   ├── cloudflare-deploy.yml         Workers deploy + PR previews
│   ├── cloudflare-pages-deploy.yml   Pages deploy + PR previews
│   ├── cloudflare-pages-cleanup.yml  Clean up Pages previews on PR close
│   ├── cloudflare-workers-cleanup.yml Update Workers preview status
│   ├── supabase-deploy.yml           Migrations + edge functions
│   ├── release-package.yml           Release every public workspace package
│   └── npm-publish.yml               Reusable Changesets and OIDC workflow
└── docs/
    └── superpowers/                  Design specs and implementation plans
```

---

## Requirements

- [Bun](https://bun.sh) runtime (all packages use `#!/usr/bin/env bun`)
- npm >=11.15.0 and <13.0.0, npm write access, and account-level 2FA (for npm-trust setup)
- A protected caller-repository `npm-publish` environment (for reusable OIDC publishing)
- GitHub Actions permission to create PRs, Changesets CLI v3, and registered npm trusted publishers (for releases)
- Cloudflare account + API token (for deploy workflows)
- Supabase project (for Supabase workflows and stripe-sync pull)
- Stripe secret key (for stripe-sync)
- [dotenvx](https://dotenvx.com) encrypted env files (for CI workflows)

---

## Author

**Hariom Sharma** -- [github.com/harryy2510](https://github.com/harryy2510)

## License

MIT

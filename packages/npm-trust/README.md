# @utilities-studio/npm-trust

Configure the same npm trusted-publisher policy across every publishable package in a repository.

The CLI supports normal repositories and declared Bun, npm, pnpm, Yarn, Lerna, or Rush monorepos. It discovers packages through `@manypkg/get-packages`, skips `private: true` packages, validates package metadata with Zod, and processes package names in deterministic order.

## Use

Run from the repository to configure every publishable package immediately:

```bash
bunx @utilities-studio/npm-trust@latest
```

The repository is detected from the checkout's `origin` remote. Defaults are `publish.yml`, environment `npm-publish`, and direct publishing. Every option is an override:

```bash
bunx @utilities-studio/npm-trust@latest \
  --repo example-org/example-repo \
  --file release-package.yml \
  --env npm-publish
```

The optional `github` subcommand remains supported. There is no dry run, `--apply`, `--yes`, or wrapper confirmation. Native npm authentication and 2FA remain interactive. Pass `--env ''` for a publisher without a GitHub environment.

For staged publishing without direct publishing, use only `--allow-stage-publish`. npm automatically allows staged publishing on new trust records, including those created with `--allow-publish`. The CLI accepts this npm-added permission without replacing a matching publisher. See [npm's allowed-actions contract](https://docs.npmjs.com/trusted-publishers/#for-github-actions).

## Guarantees

After validating local configuration and attempting the initial npm authentication check, each package independently reads its existing trust and applies the requested target. Packages run in parallel without artificial delays. An access, record-validation, revocation, or creation failure for one package does not prevent other packages from completing.

Matching records are skipped, including npm-added staging access for a direct-publish request. Stage-only requests never accept direct-publish access. Differing records are revoked by ID before their replacement is created. If npm omits a required record ID or rejects a request, that package is reported as pending after all packages finish. The CLI exits unsuccessfully when any packages remain pending.

Replacement is not atomic: if creation fails after revocation, the package can temporarily have no trusted publisher. Independent packages finish before the CLI reports completed and pending packages. Rerun the same command to create missing configurations; completed packages are skipped.

Commands use argument arrays through `Bun.spawn`, without shell interpolation. Repository detection uses `git remote get-url origin` and does not modify the checkout.

## Authentication boundary

Publishing from GitHub Actions can be tokenless. Initial trust configuration cannot be unauthenticated.

Before running the CLI:

- Publish the first version of every package.
- Use npm >=11.15.0 and <13.0.0 until npm 13's output contract is verified.
- Run `npm login` with an account that has package write access and account-level 2FA.
- Use an interactive terminal. The CLI refuses to configure trust from CI.
- When npm offers it, select the five-minute 2FA skip so the complete batch fits one approval window.

The CLI does not accept, store, or print an npm token. npm owns the login session and 2FA exchange.

OIDC authorization itself has no read-only preflight. `npm whoami`, `npm access`, and `npm publish --dry-run` do not prove that trusted publishing will work. A real `npm publish` or `npm stage publish` is the first OIDC authorization check, and staged publishing still reserves a registry version.

## Reusable workflow identity

When a caller uses Infra's reusable workflow, npm validates the caller, not the central implementation. For Lena, every package must trust:

```text
Repository:  utilities-studio/lena
Workflow:    publish.yml
Environment: npm-publish
```

Do not configure the publisher as `utilities-studio/infra` or `npm-publish.yml` for a Lena release.

## Bootstrap this package

`@utilities-studio/npm-trust` cannot configure itself before it exists on npm. Bootstrap it in this order:

1. Install and verify the workspace from Infra's root with `bun install --frozen-lockfile --ignore-scripts` and `bun run check`.
2. Create and protect Infra's `npm-publish` GitHub environment, restricted to the default branch. Allow its release workflow to write version commits to the default branch.
3. Publish the initial version manually from `packages/npm-trust` before enabling the common release workflow.
4. Register Infra's common caller workflow as the trusted publisher for every package. The command below bootstraps this package; the [root guide](../../README.md#releasing-infra-packages) covers the entire workspace.

```bash
cd packages/npm-trust
npm publish --access public

npm trust github @utilities-studio/npm-trust \
  --repo Utilities-Studio/infra \
  --file release-package.yml \
  --env npm-publish \
  --allow-publish \
  --yes
```

`release-package.yml` calls the shared workflow to version packages, commit version updates directly to the default branch, and publish without an npm token. There is no separate npm-trust publisher. Run the workspace setup command to replace trust records for retired workflows.

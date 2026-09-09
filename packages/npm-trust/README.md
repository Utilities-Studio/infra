# @utilities-studio/npm-trust

Configure the same npm trusted-publisher policy across every publishable package in a repository.

The CLI supports normal repositories and declared Bun, npm, pnpm, Yarn, Lerna, or Rush monorepos. It discovers packages through `@manypkg/get-packages`, skips `private: true` packages, validates package metadata with Zod, and processes package names in deterministic order.

## Use

Run once without `--apply` to validate authenticated access to every package and review the plan:

```bash
bunx @utilities-studio/npm-trust github \
  --repo utilities-studio/lena \
  --file publish.yml \
  --env npm-publish \
  --allow-publish
```

Apply only the missing configurations:

```bash
bunx @utilities-studio/npm-trust github \
  --repo utilities-studio/lena \
  --file publish.yml \
  --env npm-publish \
  --allow-publish \
  --apply
```

Add `--yes` to skip the wrapper's final confirmation. Native npm authentication and 2FA remain interactive.

For staged publishing, use `--allow-stage-publish`. Pass both permission flags only when the workflow needs both capabilities.

## Guarantees

The command completes in two phases:

1. It validates the repository, workflow, package metadata, registry, npm version, authentication, write access, and every existing trust record.
2. With `--apply`, it creates missing records sequentially with npm's recommended two-second request spacing.

No trust record is created unless every package passes preflight. Exact existing records are skipped. Conflicting records stop the entire plan and must be reconciled manually with `npm trust revoke`. The CLI never revokes or replaces trust automatically.

Commands are executed with argument arrays through `Bun.spawn`, not shell strings. This gives the original loop fail-fast behavior without shell interpolation. Partial success is safe to rerun because completed packages are discovered and skipped.

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
2. Create and protect Infra's `npm-publish` GitHub environment, restricted to the default branch. Enable GitHub Actions to create pull requests.
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

Later versions use the same Changesets flow as every other Infra package: run `bun run changeset` from the root, land the change, and merge the generated version PR. `release-package.yml` calls the shared workflow to publish without an npm token. There is no separate npm-trust publisher. Existing trust records for the retired workflow must be reconciled manually before enabling releases.

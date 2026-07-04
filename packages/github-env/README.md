# github-env

Load dotenv files into GitHub Actions environment files.

```bash
bunx @utilities-studio/github-env --environment production
bunx @utilities-studio/github-env --environment production --outputs AWS_REGION,AWS_ACCOUNT_ID
bunx @utilities-studio/github-env --env-file config/smoke.env --outputs AWS_REGION
bunx @utilities-studio/github-env --env-dir apps/web --environment development --outputs VITE_SITE_URL
```

## What it does

- Resolves `.env.<environment>` when `--environment` is passed.
- Falls back to `.env` only when no environment is passed.
- Parses dotenv content as data with `@dotenvx/dotenvx`.
- Writes all parsed application keys to `$GITHUB_ENV`.
- Writes step outputs only when `--outputs` is passed.
- Lowercases output names, so `AWS_REGION` becomes `aws_region`.
- Fails when a requested output key is missing.
- Fails closed for GitHub-reserved keys such as `GITHUB_*`, `RUNNER_*`, `ACTIONS_*`, and `NODE_OPTIONS`.

Dotenvx metadata keys such as `DOTENV_PUBLIC_KEY` and `DOTENV_PRIVATE_KEY` are ignored.

## GitHub Actions

```yaml
- name: Load smoke env
  id: smoke-env
  run: >
    bunx @utilities-studio/github-env
    --environment "${{ inputs.environment }}"
    --outputs AWS_REGION,AWS_ACCOUNT_ID,VITE_SITE_URL
```

Later steps in the same job can use the loaded variables normally:

```yaml
- name: Smoke test
  run: bun run smoke
```

Requested outputs are available from the step id:

```yaml
- name: Configure AWS
  run: echo "region=${{ steps.smoke-env.outputs.aws_region }}"
```

## Options

| Option | Description |
|---|---|
| `--environment <name>` | Reads `.env.<name>` from `--env-dir` or the current directory. |
| `--env-dir <path>` | Directory containing env files. Defaults to the current directory. |
| `--env-file <file>` | Explicit env file to read, relative to `--env-dir`. Cannot be used with `--environment`. |
| `--outputs <KEY,...>` | Comma-separated env keys to also expose as step outputs. No defaults. |
| `-q, --quiet` | Suppress banner and success output. |
| `-v, --version` | Print the package version. |

## Security notes

Every value written to `$GITHUB_ENV` is available to later steps in the same job.
Only use this in trusted workflows. Step outputs are allow-listed by `--outputs`
and default to none.

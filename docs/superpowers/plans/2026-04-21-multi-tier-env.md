# Multi-Tier Environment Support -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support three env tiers (none, single, multi) across sync-env, vite-env, and all deploy workflows with auto-detection.

**Architecture:** Auto-detect tier by file existence (`.env.development`/`.env.production` = multi, `.env` = single, neither = none). Each tool and workflow adapts behavior based on tier. Zero breaking changes -- existing multi-env callers unchanged.

**Tech Stack:** TypeScript (Bun), GitHub Actions YAML, dotenvx, wrangler CLI, supabase CLI

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/sync-env/src/index.ts` | Modify | Add `detectTier()`, `loadEnvFiles()`, adapt `syncCloudflare()` for root-level vars, adapt `syncSupabase()` for single-env, adapt `parseArgs()` and `main()` |
| `packages/vite-env/src/index.ts` | Modify | Fallback to `.env` when `.env.development` missing |
| `.github/workflows/cloudflare-deploy.yml` | Modify | Detect step, tier-conditional env vars/flags/secrets, new `DOTENV_PRIVATE_KEY` secret |
| `.github/workflows/cloudflare-pages-deploy.yml` | Modify | Detect step, tier-conditional dotenvx key, single-env build mode |
| `.github/workflows/supabase-deploy.yml` | Modify | Optional `environment` input, detect step, `.env` fallback |

---

### Task 1: sync-env -- tier detection and env loading

**Files:**
- Modify: `packages/sync-env/src/index.ts:8-16` (config section), `:178-229` (main + parseArgs)

- [ ] **Step 1: Add `EnvTier` type and `detectTier()` function**

Add after the `ENVIRONMENTS` config block (line 15):

```typescript
type EnvTier = 'multi' | 'single' | 'none'

async function detectTier(): Promise<EnvTier> {
	const hasDev = await Bun.file(join(ROOT, '.env.development')).exists()
	const hasProd = await Bun.file(join(ROOT, '.env.production')).exists()
	if (hasDev || hasProd) return 'multi'
	if (await Bun.file(join(ROOT, '.env')).exists()) return 'single'
	return 'none'
}
```

- [ ] **Step 2: Add `loadEnvFiles()` function**

Add after `detectTier()`:

```typescript
async function loadEnvFiles(
	tier: EnvTier,
	requestedEnvs: Environment[],
): Promise<Record<string, Record<string, string>>> {
	const envVars: Record<string, Record<string, string>> = {}

	if (tier === 'none') return envVars

	if (tier === 'single') {
		const envFile = Bun.file(join(ROOT, '.env'))
		if (!(await envFile.exists())) return envVars
		envVars['root'] = parse(await envFile.text())
		console.log(`  loaded .env (${Object.keys(envVars['root']).length} keys)`)
		return envVars
	}

	for (const env of requestedEnvs) {
		const envFile = Bun.file(join(ROOT, `.env.${env}`))
		if (!(await envFile.exists())) {
			console.log(`  .env.${env} not found, skipping`)
			continue
		}
		envVars[env] = parse(await envFile.text())
		console.log(`  loaded .env.${env} (${Object.keys(envVars[env]).length} keys)`)
	}

	return envVars
}
```

- [ ] **Step 3: Rewrite `parseArgs()` to return optional envs**

Replace the `parseArgs` function:

```typescript
function parseArgs(): { envs: Environment[]; targets: Target[]; explicitEnv: boolean } {
	const raw = process.argv.slice(2)
	const targets: Target[] = []
	const envs: Environment[] = []

	for (let i = 0; i < raw.length; i++) {
		if (raw[i] === '--env' && raw[i + 1]) {
			const val = raw[++i] as Environment
			if (ENVIRONMENTS.includes(val)) envs.push(val)
		} else if (TARGETS.includes(raw[i] as Target)) {
			targets.push(raw[i] as Target)
		}
	}

	return {
		envs: envs.length > 0 ? envs : [...ENVIRONMENTS],
		targets: targets.length > 0 ? targets : [...TARGETS],
		explicitEnv: envs.length > 0,
	}
}
```

- [ ] **Step 4: Rewrite `main()` to use tier detection**

Replace the `main` function:

```typescript
async function main() {
	const start = performance.now()
	const { envs, targets, explicitEnv } = parseArgs()
	const tier = explicitEnv ? 'multi' : await detectTier()

	console.log(`Env tier: ${tier}`)
	console.log(`Syncing env vars -> ${targets.join(', ')}`)

	if (tier === 'none') {
		console.log('\nNo env files found. Nothing to sync.')
		return
	}

	if (explicitEnv) {
		for (const env of envs) {
			const envFile = Bun.file(join(ROOT, `.env.${env}`))
			if (!(await envFile.exists())) {
				console.error(`Error: .env.${env} not found (--env ${env} was explicitly requested)`)
				process.exit(1)
			}
		}
	}

	const envVars = await loadEnvFiles(tier, envs)

	if (Object.keys(envVars).length === 0) {
		console.log('\nNo env files loaded. Nothing to sync.')
		return
	}

	if (targets.includes('cloudflare')) await syncCloudflare(envVars)
	if (targets.includes('supabase')) await syncSupabase(envVars)

	const elapsed = ((performance.now() - start) / 1000).toFixed(1)
	console.log(`\nDone in ${elapsed}s.`)
}
```

- [ ] **Step 5: Verify no TypeScript errors**

Run: `cd packages/sync-env && bunx tsc --noEmit`
Expected: no errors (the old inline loading code in `main()` is fully replaced)

- [ ] **Step 6: Commit**

```bash
git add packages/sync-env/src/index.ts
git commit -m "feat(sync-env): add tier detection and env file loading"
```

---

### Task 2: sync-env -- single-env Cloudflare support (root-level vars)

**Files:**
- Modify: `packages/sync-env/src/index.ts:74-127` (`syncCloudflare` function)

- [ ] **Step 1: Rewrite `syncCloudflare()` to handle root vs env-scoped vars**

Replace the `syncCloudflare` function:

```typescript
async function syncCloudflare(envVars: Record<string, Record<string, string>>) {
	console.log('\n── Cloudflare ──────────────────────────────────────\n')

	const wranglerPath = join(ROOT, 'wrangler.jsonc')
	const wrangler = parseJsonc(await Bun.file(wranglerPath).text()) as Record<string, unknown>

	const isRoot = 'root' in envVars

	console.log('  vars (wrangler.jsonc):')
	if (isRoot) {
		const vars: Record<string, string> = {}
		for (const [key, value] of Object.entries(envVars['root'])) {
			if (!value || CF_SKIP_KEYS.has(key) || isSecretKey(key)) continue
			vars[key] = value
		}
		;(wrangler as Record<string, unknown>).vars = vars
		console.log(`    root: ${Object.keys(vars).length} vars`)
	} else {
		const envBlock = (wrangler.env ?? {}) as Record<string, { vars?: Record<string, string> }>
		for (const [env, allVars] of Object.entries(envVars)) {
			const vars: Record<string, string> = {}
			for (const [key, value] of Object.entries(allVars)) {
				if (!value || CF_SKIP_KEYS.has(key) || isSecretKey(key)) continue
				vars[key] = value
			}
			envBlock[env] = { ...envBlock[env], vars }
			console.log(`    ${env}: ${Object.keys(vars).length} vars`)
		}
		wrangler.env = envBlock
	}

	await Bun.write(wranglerPath, JSON.stringify(wrangler, null, '\t') + '\n')

	console.log('\n  secrets (bulk upload):')
	for (const [env, allVars] of Object.entries(envVars)) {
		const secrets = Object.fromEntries(
			Object.entries(allVars).filter(
				([key, value]) => value && isSecretKey(key) && !CF_SKIP_KEYS.has(key),
			),
		)
		const count = Object.keys(secrets).length

		if (count === 0) {
			console.log(`    ${env}: no secrets to push`)
			continue
		}

		const tmpFile = join(ROOT, `.cf-secrets-${env}.json`)
		await Bun.write(tmpFile, JSON.stringify(secrets))

		const envFlag = env === 'root' ? '' : ` --env ${env}`
		const { ok, output } = await run(
			`bunx wrangler versions secret bulk ${tmpFile}${envFlag}`,
		)

		const { unlink } = await import('node:fs/promises')
		await unlink(tmpFile)

		if (ok) {
			console.log(`    ${env}: ok (${count} secrets)`)
			for (const key of Object.keys(secrets)) console.log(`      ok ${key}`)
		} else {
			console.log(`    ${env}: FAIL`)
			console.log(`      ${output.split('\n')[0]}`)
		}
	}
}
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd packages/sync-env && bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/sync-env/src/index.ts
git commit -m "feat(sync-env): support root-level wrangler vars for single-env tier"
```

---

### Task 3: vite-env -- fallback to `.env`

**Files:**
- Modify: `packages/vite-env/src/index.ts:6-9`

- [ ] **Step 1: Replace hardcoded `.env.development` with fallback chain**

Replace lines 6-9 of `packages/vite-env/src/index.ts`:

```typescript
// before:
const ENV_FILE = join(ROOT, '.env.development')

if (!(await Bun.file(ENV_FILE).exists())) {
	console.log('Skipping vite-env generation (.env.development not found)')
	process.exit(0)
}
```

```typescript
// after:
const ENV_DEV = join(ROOT, '.env.development')
const ENV_ROOT = join(ROOT, '.env')

const envFile = (await Bun.file(ENV_DEV).exists())
	? ENV_DEV
	: (await Bun.file(ENV_ROOT).exists())
		? ENV_ROOT
		: null

if (!envFile) {
	console.log('Skipping vite-env generation (no .env.development or .env found)')
	process.exit(0)
}
```

Note: The rest of the file reads from `process.env` (not from the file directly), so the env file path is only used for the existence check. dotenvx loads the correct file before this script runs.

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd packages/vite-env && bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/vite-env/src/index.ts
git commit -m "feat(vite-env): fallback to .env when .env.development missing"
```

---

### Task 4: cloudflare-deploy.yml -- tier-aware workflow

**Files:**
- Modify: `.github/workflows/cloudflare-deploy.yml`

- [ ] **Step 1: Add `DOTENV_PRIVATE_KEY` secret**

In the `secrets:` block, add after `DOTENV_PRIVATE_KEY_PRODUCTION`:

```yaml
      DOTENV_PRIVATE_KEY:
        required: false
```

- [ ] **Step 2: Add detect env tier step**

Add after the "Checkout repository" step (after line 68):

```yaml
      - name: Detect env tier
        id: env-tier
        run: |
          if [ -f .env.development ] || [ -f .env.production ]; then
            echo "tier=multi" >> "$GITHUB_OUTPUT"
          elif [ -f .env ]; then
            echo "tier=single" >> "$GITHUB_OUTPUT"
          else
            echo "tier=none" >> "$GITHUB_OUTPUT"
          fi
```

- [ ] **Step 3: Rewrite job-level `env:` block to be tier-aware**

Replace the `env:` block (lines 52-58) with:

```yaml
    env:
      IS_PREVIEW: ${{ github.event.pull_request.number != '' }}
```

The tier-dependent values (`ENV_FLAG`, `MODE_FLAG`, `PREVIEW_ENV_FLAG`, dotenvx keys) move into step-level `env:` or get computed from the detect step output.

- [ ] **Step 4: Update sync-env step to be tier-conditional**

Replace the "Push secrets to Cloudflare" step:

```yaml
      - name: Push secrets to Cloudflare
        if: ${{ !inputs.skip_sync_env && steps.env-tier.outputs.tier != 'none' }}
        run: bunx @utilities-studio/sync-env@latest cloudflare ${{ inputs.environment != '' && format('--env {0}', inputs.environment) || '' }}
        env:
          DOTENV_PRIVATE_KEY_DEVELOPMENT: ${{ inputs.environment == 'development' && secrets.DOTENV_PRIVATE_KEY_DEVELOPMENT || '' }}
          DOTENV_PRIVATE_KEY_PRODUCTION: ${{ inputs.environment == 'production' && secrets.DOTENV_PRIVATE_KEY_PRODUCTION || '' }}
          DOTENV_PRIVATE_KEY: ${{ steps.env-tier.outputs.tier == 'single' && secrets.DOTENV_PRIVATE_KEY || '' }}
```

- [ ] **Step 5: Update Build step to be tier-aware**

Replace the "Build" step:

```yaml
      - name: Build
        if: ${{ !inputs.skip_build }}
        run: bun run build ${{ inputs.environment != '' && format('-- --mode {0}', inputs.environment) || '' }}
        env:
          CLOUDFLARE_ENV: ${{ inputs.environment }}
          DOTENV_PRIVATE_KEY_DEVELOPMENT: ${{ inputs.environment == 'development' && secrets.DOTENV_PRIVATE_KEY_DEVELOPMENT || '' }}
          DOTENV_PRIVATE_KEY_PRODUCTION: ${{ inputs.environment == 'production' && secrets.DOTENV_PRIVATE_KEY_PRODUCTION || '' }}
          DOTENV_PRIVATE_KEY: ${{ steps.env-tier.outputs.tier == 'single' && secrets.DOTENV_PRIVATE_KEY || '' }}
```

- [ ] **Step 6: Update Deploy step -- remove env flag when not multi**

Replace the "Deploy" step:

```yaml
      - name: Deploy
        if: env.IS_PREVIEW != 'true'
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: deploy ${{ inputs.environment != '' && format('--env {0}', inputs.environment) || '' }}
          workingDirectory: ${{ inputs.working_directory }}
          packageManager: bun
```

- [ ] **Step 7: Update preview upload step -- remove env flag when not multi**

Replace the "Upload preview version" step:

```yaml
      - name: Upload preview version
        if: env.IS_PREVIEW == 'true'
        id: preview
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: versions upload ${{ inputs.environment != '' && '--env development' || '' }} --preview-alias pr-${{ github.event.pull_request.number }}
          workingDirectory: ${{ inputs.working_directory }}
          packageManager: bun
```

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/cloudflare-deploy.yml
git commit -m "feat(workflows): support multi-tier env detection in cloudflare-deploy"
```

---

### Task 5: cloudflare-pages-deploy.yml -- tier-aware workflow

**Files:**
- Modify: `.github/workflows/cloudflare-pages-deploy.yml`

- [ ] **Step 1: Add `DOTENV_PRIVATE_KEY` secret**

In the `secrets:` block, add after `DOTENV_PRIVATE_KEY_PRODUCTION`:

```yaml
      DOTENV_PRIVATE_KEY:
        required: false
```

- [ ] **Step 2: Add detect env tier step**

Add after the "Checkout repository" step:

```yaml
      - name: Detect env tier
        id: env-tier
        run: |
          if [ -f .env.development ] || [ -f .env.production ]; then
            echo "tier=multi" >> "$GITHUB_OUTPUT"
          elif [ -f .env ]; then
            echo "tier=single" >> "$GITHUB_OUTPUT"
          else
            echo "tier=none" >> "$GITHUB_OUTPUT"
          fi
```

- [ ] **Step 3: Update job-level `env:` block**

Replace the `env:` block (lines 49-52) with:

```yaml
    env:
      IS_PREVIEW: ${{ github.event.pull_request.number != '' }}
```

Dotenvx keys move to step-level env.

- [ ] **Step 4: Add a step to compute build mode, then update Build step**

Add a compute step before Build:

```yaml
      - name: Compute build mode
        id: build-mode
        run: |
          TIER="${{ steps.env-tier.outputs.tier }}"
          IS_PREVIEW="${{ env.IS_PREVIEW }}"
          if [ "$TIER" = "multi" ]; then
            if [ "$IS_PREVIEW" = "true" ]; then
              echo "mode=development" >> "$GITHUB_OUTPUT"
            else
              echo "mode=production" >> "$GITHUB_OUTPUT"
            fi
          else
            echo "mode=" >> "$GITHUB_OUTPUT"
          fi
```

Replace the "Build" step:

```yaml
      - name: Build
        run: bun run build ${{ steps.build-mode.outputs.mode != '' && format('-- --mode {0}', steps.build-mode.outputs.mode) || '' }}
        env:
          CLOUDFLARE_ENV: ${{ steps.build-mode.outputs.mode }}
          DOTENV_PRIVATE_KEY_DEVELOPMENT: ${{ secrets.DOTENV_PRIVATE_KEY_DEVELOPMENT }}
          DOTENV_PRIVATE_KEY_PRODUCTION: ${{ env.IS_PREVIEW != 'true' && secrets.DOTENV_PRIVATE_KEY_PRODUCTION || '' }}
          DOTENV_PRIVATE_KEY: ${{ steps.env-tier.outputs.tier == 'single' && secrets.DOTENV_PRIVATE_KEY || '' }}
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/cloudflare-pages-deploy.yml
git commit -m "feat(workflows): support multi-tier env detection in cloudflare-pages-deploy"
```

---

### Task 6: supabase-deploy.yml -- optional environment input

**Files:**
- Modify: `.github/workflows/supabase-deploy.yml`

- [ ] **Step 1: Make `environment` input optional with default empty string**

Replace the `environment` input (lines 8-10):

```yaml
      environment:
        description: 'Environment to deploy (omit for single-env projects)'
        required: false
        type: string
        default: ''
```

- [ ] **Step 2: Add `DOTENV_PRIVATE_KEY` secret**

In the `secrets:` block, add:

```yaml
      DOTENV_PRIVATE_KEY:
        required: false
```

- [ ] **Step 3: Add detect step and compute env file path**

Add after the "Install dependencies" step, replacing the "Load env vars" step. First, the detect step:

```yaml
      - name: Resolve env file
        id: env-file
        run: |
          if [ -n "${{ inputs.environment }}" ]; then
            FILE=".env.${{ inputs.environment }}"
          elif [ -f .env ]; then
            FILE=".env"
          else
            echo "Error: No env file found (no environment input and no .env)" && exit 1
          fi
          if [ ! -f "$FILE" ]; then
            echo "Error: $FILE not found" && exit 1
          fi
          echo "path=$FILE" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 4: Update "Load env vars" step to use resolved env file**

Replace the "Load env vars" step:

```yaml
      - name: Load env vars
        run: |
          while IFS= read -r line; do
            [[ -z "$line" || "$line" =~ ^# ]] && continue
            key="${line%%=*}"
            value="${line#*=}"
            value="${value%\"}"
            value="${value#\"}"
            [[ "$key" =~ ^(DOTENV_|NODE_OPTIONS|VITE_) ]] && continue
            echo "::add-mask::$value"
            echo "$key=$value" >> "$GITHUB_ENV"
          done < ${{ steps.env-file.outputs.path }}
        env:
          DOTENV_PRIVATE_KEY_DEVELOPMENT: ${{ inputs.environment == 'development' && secrets.DOTENV_PRIVATE_KEY_DEVELOPMENT || '' }}
          DOTENV_PRIVATE_KEY_PRODUCTION: ${{ inputs.environment == 'production' && secrets.DOTENV_PRIVATE_KEY_PRODUCTION || '' }}
          DOTENV_PRIVATE_KEY: ${{ inputs.environment == '' && secrets.DOTENV_PRIVATE_KEY || '' }}
```

- [ ] **Step 5: Update sync-env step**

Replace the "Sync edge function secrets" step:

```yaml
      - name: Sync edge function secrets
        run: bunx @utilities-studio/sync-env@latest supabase ${{ inputs.environment != '' && format('--env {0}', inputs.environment) || '' }}
```

- [ ] **Step 6: Update env block and environment/concurrency for optional input**

Replace the job-level `env:` block:

```yaml
    env:
      DOTENV_PRIVATE_KEY_DEVELOPMENT: ${{ inputs.environment == 'development' && secrets.DOTENV_PRIVATE_KEY_DEVELOPMENT || '' }}
      DOTENV_PRIVATE_KEY_PRODUCTION: ${{ inputs.environment == 'production' && secrets.DOTENV_PRIVATE_KEY_PRODUCTION || '' }}
      DOTENV_PRIVATE_KEY: ${{ inputs.environment == '' && secrets.DOTENV_PRIVATE_KEY || '' }}
```

Update `environment:` and `concurrency:`:

```yaml
    concurrency:
      group: supabase-deploy-${{ inputs.environment || 'default' }}-${{ github.repository }}
      cancel-in-progress: false

    environment: ${{ inputs.environment || 'production' }}
```

- [ ] **Step 7: Update deploy tag step for optional environment**

Replace the "Tag deployment" step:

```yaml
      - name: Tag deployment
        env:
          DEPLOY_ENV: ${{ inputs.environment }}
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          SUFFIX="${DEPLOY_ENV:+${DEPLOY_ENV}-}"
          TAG="supabase-deploy-${SUFFIX}$(date -u +%Y%m%d-%H%M%S)"
          git tag "$TAG"
          git push origin "$TAG"
```

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/supabase-deploy.yml
git commit -m "feat(workflows): make supabase-deploy environment optional for single-env"
```

---

### Task 7: Final review and version bumps

**Files:**
- Modify: `packages/sync-env/package.json` (version bump)
- Modify: `packages/vite-env/package.json` (version bump)

- [ ] **Step 1: Dry-run sync-env against a test scenario**

Create a temp dir, put a `.env` file in it, create a minimal `wrangler.jsonc`, and run sync-env to verify single-env detection works:

```bash
cd /tmp && mkdir -p sync-env-test && cd sync-env-test
echo 'VITE_APP_URL=https://example.com\nSOME_API_KEY=secret123' > .env
echo '{}' > wrangler.jsonc
node /Users/harryy/Desktop/utilities-studio/infra/packages/sync-env/src/index.ts cloudflare
```

Expected output:
```
Env tier: single
Syncing env vars -> cloudflare
  loaded .env (2 keys)

── Cloudflare ──────────────────────────────────────

  vars (wrangler.jsonc):
    root: 1 vars
```

The `wrangler.jsonc` should have `"vars": { "VITE_APP_URL": "https://example.com" }` at root level. `SOME_API_KEY` should be in secrets (contains `API_KEY`).

- [ ] **Step 2: Test no-env scenario**

```bash
cd /tmp && mkdir -p sync-env-none && cd sync-env-none
node /Users/harryy/Desktop/utilities-studio/infra/packages/sync-env/src/index.ts cloudflare
```

Expected output:
```
Env tier: none
Syncing env vars -> cloudflare

No env files found. Nothing to sync.
```

- [ ] **Step 3: Test explicit --env with missing file (should error)**

```bash
cd /tmp/sync-env-none
node /Users/harryy/Desktop/utilities-studio/infra/packages/sync-env/src/index.ts cloudflare --env development
```

Expected: error exit with message about `.env.development` not found.

- [ ] **Step 4: Clean up test dirs**

```bash
rm -rf /tmp/sync-env-test /tmp/sync-env-none
```

- [ ] **Step 5: Commit final state**

```bash
git add -A
git commit -m "feat: multi-tier env support across sync-env, vite-env, and deploy workflows"
```

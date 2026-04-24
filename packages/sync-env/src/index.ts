#!/usr/bin/env bun
import { parse } from 'dotenv'
import { parse as parseJsonc } from 'jsonc-parser'
import { join, relative } from 'node:path'

// ──────────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────────

const ENVIRONMENTS = ['development', 'production'] as const
type Environment = (typeof ENVIRONMENTS)[number]

type EnvTier = 'multi' | 'single' | 'none'

async function detectTier(envDir: string): Promise<EnvTier> {
	const hasDev = await Bun.file(join(envDir, '.env.development')).exists()
	const hasProd = await Bun.file(join(envDir, '.env.production')).exists()
	if (hasDev || hasProd) return 'multi'
	if (await Bun.file(join(envDir, '.env')).exists()) return 'single'
	return 'none'
}

async function loadEnvFiles(
	envDir: string,
	tier: EnvTier,
	requestedEnvs: Environment[],
): Promise<Record<string, Record<string, string>>> {
	const envVars: Record<string, Record<string, string>> = {}

	if (tier === 'none') return envVars

	if (tier === 'single') {
		const envFile = Bun.file(join(envDir, '.env'))
		if (!(await envFile.exists())) return envVars
		envVars['root'] = parse(await envFile.text())
		console.log(`  loaded .env (${Object.keys(envVars['root']).length} keys)`)
		return envVars
	}

	for (const env of requestedEnvs) {
		const envFile = Bun.file(join(envDir, `.env.${env}`))
		if (!(await envFile.exists())) {
			console.log(`  .env.${env} not found, skipping`)
			continue
		}
		envVars[env] = parse(await envFile.text())
		console.log(`  loaded .env.${env} (${Object.keys(envVars[env]).length} keys)`)
	}

	return envVars
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function isSecretKey(key: string): boolean {
	if (key.startsWith('VITE_') || key.startsWith('PUBLISHABLE')) return false
	return (
		key.includes('SECRET') ||
		key.includes('API_KEY') ||
		key.includes('TOKEN') ||
		key.includes('SERVICE_ROLE_KEY') ||
		key.includes('PRIVATE_KEY')
	)
}

async function run(cmd: string, cwd: string): Promise<{ ok: boolean; output: string }> {
	const proc = Bun.spawn(['sh', '-c', cmd], { cwd, stdout: 'pipe', stderr: 'pipe' })
	const stdout = await new Response(proc.stdout).text()
	const stderr = await new Response(proc.stderr).text()
	const exitCode = await proc.exited
	return exitCode === 0
		? { ok: true, output: stdout }
		: { ok: false, output: stderr || stdout }
}

// ──────────────────────────────────────────────────────────────────────────────
// Scan: find all Deno.env.get() calls in supabase/functions/
// ──────────────────────────────────────────────────────────────────────────────

async function scanEdgeFunctionEnvKeys(rootDir: string): Promise<Set<string>> {
	const functionsDir = join(rootDir, 'supabase/functions')
	const keys = new Set<string>()
	const envGetPattern = /Deno\.env\.get\(\s*['"]([^'"]+)['"]\s*\)/g
	const glob = new Bun.Glob('**/*.{ts,js}')

	try {
		for await (const path of glob.scan({ cwd: functionsDir })) {
			const content = await Bun.file(join(functionsDir, path)).text()
			for (const match of content.matchAll(envGetPattern)) {
				keys.add(match[1])
			}
		}
	} catch {
		// supabase/functions/ may not exist
	}

	return keys
}

/** Keys to exclude from Cloudflare entirely (local-only, dotenvx internal, or Supabase-edge-only) */
const CF_SKIP_KEYS = new Set([
	'DOTENV_PUBLIC_KEY',
	'DOTENV_PUBLIC_KEY_DEVELOPMENT',
	'DOTENV_PUBLIC_KEY_PRODUCTION',
	'NODE_OPTIONS',
	'SUPABASE_ACCESS_TOKEN',
	'SUPABASE_DB_URL',
])

// ──────────────────────────────────────────────────────────────────────────────
// Discover wrangler.jsonc files (monorepo support)
// ──────────────────────────────────────────────────────────────────────────────

async function discoverWranglerConfigs(rootDir: string): Promise<string[]> {
	const rootConfig = join(rootDir, 'wrangler.jsonc')
	if (await Bun.file(rootConfig).exists()) {
		return [rootConfig]
	}

	const configs: string[] = []
	const glob = new Bun.Glob('apps/*/wrangler.jsonc')

	for await (const path of glob.scan({ cwd: rootDir })) {
		configs.push(join(rootDir, path))
	}

	if (configs.length === 0) {
		const packagesGlob = new Bun.Glob('packages/*/wrangler.jsonc')
		for await (const path of packagesGlob.scan({ cwd: rootDir })) {
			configs.push(join(rootDir, path))
		}
	}

	return configs.sort()
}

// ──────────────────────────────────────────────────────────────────────────────
// Sync: Cloudflare -- vars to wrangler.jsonc, secrets via bulk upload
// ──────────────────────────────────────────────────────────────────────────────

async function syncCloudflareForConfig(
	wranglerPath: string,
	envVars: Record<string, Record<string, string>>,
	rootDir: string,
) {
	const displayPath = relative(rootDir, wranglerPath) || 'wrangler.jsonc'
	console.log(`\n  ── ${displayPath} ──`)

	const wrangler = parseJsonc(await Bun.file(wranglerPath).text()) as Record<string, unknown>
	const wranglerDir = join(wranglerPath, '..')

	const isRoot = 'root' in envVars

	console.log('    vars (wrangler.jsonc):')
	if (isRoot) {
		const vars: Record<string, string> = {}
		for (const [key, value] of Object.entries(envVars['root'])) {
			if (!value || CF_SKIP_KEYS.has(key) || isSecretKey(key)) continue
			vars[key] = value
		}
		;(wrangler as Record<string, unknown>).vars = vars
		console.log(`      root: ${Object.keys(vars).length} vars`)
	} else {
		const envBlock = (wrangler.env ?? {}) as Record<string, { vars?: Record<string, string> }>
		for (const [env, allVars] of Object.entries(envVars)) {
			const vars: Record<string, string> = {}
			for (const [key, value] of Object.entries(allVars)) {
				if (!value || CF_SKIP_KEYS.has(key) || isSecretKey(key)) continue
				vars[key] = value
			}
			envBlock[env] = { ...envBlock[env], vars }
			console.log(`      ${env}: ${Object.keys(vars).length} vars`)
		}
		wrangler.env = envBlock
	}

	await Bun.write(wranglerPath, JSON.stringify(wrangler, null, '\t') + '\n')

	console.log('    secrets (bulk upload):')
	for (const [env, allVars] of Object.entries(envVars)) {
		const secrets = Object.fromEntries(
			Object.entries(allVars).filter(
				([key, value]) => value && isSecretKey(key) && !CF_SKIP_KEYS.has(key),
			),
		)
		const count = Object.keys(secrets).length

		if (count === 0) {
			console.log(`      ${env}: no secrets to push`)
			continue
		}

		const tmpFile = join(wranglerDir, `.cf-secrets-${env}.json`)
		await Bun.write(tmpFile, JSON.stringify(secrets))

		const envFlag = env === 'root' ? '' : ` --env ${env}`
		const { ok, output } = await run(
			`bunx wrangler versions secret bulk ${tmpFile}${envFlag}`,
			wranglerDir,
		)

		const { unlink } = await import('node:fs/promises')
		await unlink(tmpFile)

		if (ok) {
			console.log(`      ${env}: ok (${count} secrets)`)
			for (const key of Object.keys(secrets)) console.log(`        ok ${key}`)
		} else {
			console.log(`      ${env}: FAIL`)
			console.log(`        ${output.split('\n')[0]}`)
		}
	}
}

async function syncCloudflare(
	envVars: Record<string, Record<string, string>>,
	rootDir: string,
) {
	console.log('\n── Cloudflare ──────────────────────────────────────\n')

	const configs = await discoverWranglerConfigs(rootDir)

	if (configs.length === 0) {
		console.log('  No wrangler.jsonc found. Skipping Cloudflare sync.')
		return
	}

	if (configs.length > 1) {
		console.log(`  Found ${configs.length} wrangler configs (monorepo mode)`)
	}

	for (const configPath of configs) {
		await syncCloudflareForConfig(configPath, envVars, rootDir)
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Sync: Supabase -- only keys edge functions actually use (auto-scanned)
// ──────────────────────────────────────────────────────────────────────────────

async function syncSupabase(
	envVars: Record<string, Record<string, string>>,
	rootDir: string,
) {
	const edgeKeys = await scanEdgeFunctionEnvKeys(rootDir)

	console.log('\n── Supabase (edge function secrets) ─────────────────')

	if (edgeKeys.size === 0) {
		console.log('  No supabase/functions/ found or no Deno.env.get() calls. Skipping.')
		return
	}

	console.log(`  scanned keys: ${[...edgeKeys].sort().join(', ')}\n`)

	for (const [env, vars] of Object.entries(envVars)) {
		const projectId = vars.SUPABASE_PROJECT_ID
		if (!projectId) {
			console.log(`  ${env}: skip (no SUPABASE_PROJECT_ID)`)
			continue
		}

		const entries = Object.entries(vars).filter(
			([key, value]) =>
				edgeKeys.has(key) && value && !key.startsWith('SUPABASE_'),
		)

		if (entries.length === 0) {
			console.log(`  ${env}: no secrets to set`)
			continue
		}

		const pairs = entries.map(([key, value]) => `${key}=${value}`)
		const { ok, output } = await run(
			`bunx supabase secrets set ${pairs.join(' ')} --project-ref ${projectId}`,
			rootDir,
		)

		if (ok) {
			console.log(`  ${env}: ok (${entries.length} secrets)`)
			for (const [key] of entries) console.log(`    ok ${key}`)
		} else {
			console.log(`  ${env}: FAIL`)
			console.log(`    ${output.split('\n')[0]}`)
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

const TARGETS = ['cloudflare', 'supabase'] as const
type Target = (typeof TARGETS)[number]

async function main() {
	const start = performance.now()
	const { envs, targets, explicitEnv, envDir } = parseArgs()

	const rootDir = process.cwd()
	const resolvedEnvDir = envDir ? join(rootDir, envDir) : rootDir
	const tier = explicitEnv ? 'multi' : await detectTier(resolvedEnvDir)

	console.log(`Env tier: ${tier}`)
	console.log(`Env dir: ${relative(rootDir, resolvedEnvDir) || '.'}`)
	console.log(`Syncing env vars -> ${targets.join(', ')}`)

	if (tier === 'none') {
		console.log('\nNo env files found. Nothing to sync.')
		return
	}

	if (explicitEnv) {
		for (const env of envs) {
			const envFile = Bun.file(join(resolvedEnvDir, `.env.${env}`))
			if (!(await envFile.exists())) {
				console.error(`Error: .env.${env} not found in ${resolvedEnvDir} (--env ${env} was explicitly requested)`)
				process.exit(1)
			}
		}
	}

	const envVars = await loadEnvFiles(resolvedEnvDir, tier, envs)

	if (Object.keys(envVars).length === 0) {
		console.log('\nNo env files loaded. Nothing to sync.')
		return
	}

	if (targets.includes('cloudflare')) await syncCloudflare(envVars, rootDir)
	if (targets.includes('supabase')) await syncSupabase(envVars, rootDir)

	const elapsed = ((performance.now() - start) / 1000).toFixed(1)
	console.log(`\nDone in ${elapsed}s.`)
}

function parseArgs(): { envs: Environment[]; targets: Target[]; explicitEnv: boolean; envDir: string | null } {
	const raw = process.argv.slice(2)
	const targets: Target[] = []
	const envs: Environment[] = []
	let envDir: string | null = null

	for (let i = 0; i < raw.length; i++) {
		if (raw[i] === '--env' && raw[i + 1]) {
			const val = raw[++i] as Environment
			if (ENVIRONMENTS.includes(val)) envs.push(val)
		} else if (raw[i] === '--env-dir' && raw[i + 1]) {
			envDir = raw[++i]
		} else if (TARGETS.includes(raw[i] as Target)) {
			targets.push(raw[i] as Target)
		}
	}

	return {
		envs: envs.length > 0 ? envs : [...ENVIRONMENTS],
		targets: targets.length > 0 ? targets : [...TARGETS],
		explicitEnv: envs.length > 0,
		envDir,
	}
}

main()

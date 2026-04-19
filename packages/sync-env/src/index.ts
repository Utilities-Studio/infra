#!/usr/bin/env bun
import { parse } from 'dotenv'
import { parse as parseJsonc } from 'jsonc-parser'
import { join } from 'node:path'

const ROOT = process.cwd()

// ──────────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────────

const ENVIRONMENTS = ['development', 'production'] as const
type Environment = (typeof ENVIRONMENTS)[number]

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

async function parseEnvFile(path: string): Promise<Record<string, string>> {
	return parse(await Bun.file(path).text())
}

async function run(cmd: string): Promise<{ ok: boolean; output: string }> {
	const proc = Bun.spawn(['sh', '-c', cmd], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
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

async function scanEdgeFunctionEnvKeys(): Promise<Set<string>> {
	const functionsDir = join(ROOT, 'supabase/functions')
	const keys = new Set<string>()
	const envGetPattern = /Deno\.env\.get\(\s*['"]([^'"]+)['"]\s*\)/g
	const glob = new Bun.Glob('**/*.{ts,js}')

	for await (const path of glob.scan({ cwd: functionsDir })) {
		const content = await Bun.file(join(functionsDir, path)).text()
		for (const match of content.matchAll(envGetPattern)) {
			keys.add(match[1])
		}
	}

	return keys
}

/** Keys to exclude from Cloudflare entirely (local-only, dotenvx internal, or Supabase-edge-only) */
const CF_SKIP_KEYS = new Set([
	'DOTENV_PUBLIC_KEY_DEVELOPMENT',
	'DOTENV_PUBLIC_KEY_PRODUCTION',
	'NODE_OPTIONS',
	'SUPABASE_ACCESS_TOKEN',
	'SUPABASE_DB_URL',
])

// ──────────────────────────────────────────────────────────────────────────────
// Sync: Cloudflare — vars to wrangler.jsonc, secrets via bulk upload
// ──────────────────────────────────────────────────────────────────────────────

async function syncCloudflare(envVars: Record<string, Record<string, string>>) {
	console.log('\n── Cloudflare ──────────────────────────────────────\n')

	const wranglerPath = join(ROOT, 'wrangler.jsonc')
	const wrangler = parseJsonc(await Bun.file(wranglerPath).text()) as {
		env: Record<string, { vars?: Record<string, string> }>
	}

	console.log('  vars (wrangler.jsonc):')
	for (const [env, allVars] of Object.entries(envVars)) {
		const vars: Record<string, string> = {}
		for (const [key, value] of Object.entries(allVars)) {
			if (!value || CF_SKIP_KEYS.has(key) || isSecretKey(key)) continue
			vars[key] = value
		}
		wrangler.env[env] = { ...wrangler.env[env], vars }
		console.log(`    ${env}: ${Object.keys(vars).length} vars`)
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

		const { ok, output } = await run(
			`bunx wrangler versions secret bulk ${tmpFile} --env ${env}`,
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

// ──────────────────────────────────────────────────────────────────────────────
// Sync: Supabase — only keys edge functions actually use (auto-scanned)
// ──────────────────────────────────────────────────────────────────────────────

async function syncSupabase(envVars: Record<string, Record<string, string>>) {
	const edgeKeys = await scanEdgeFunctionEnvKeys()

	console.log('\n── Supabase (edge function secrets) ─────────────────')
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
	const { envs, targets } = parseArgs()

	console.log(`Syncing env vars -> ${targets.join(', ')} (${envs.join(', ')})`)

	const envVars: Record<string, Record<string, string>> = {}
	for (const env of envs) {
		envVars[env] = await parseEnvFile(join(ROOT, `.env.${env}`))
		console.log(
			`  loaded .env.${env} (${Object.keys(envVars[env]).length} keys)`,
		)
	}

	if (targets.includes('cloudflare')) await syncCloudflare(envVars)
	if (targets.includes('supabase')) await syncSupabase(envVars)

	const elapsed = ((performance.now() - start) / 1000).toFixed(1)
	console.log(`\nDone in ${elapsed}s.`)
}

function parseArgs(): { envs: Environment[]; targets: Target[] } {
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
	}
}

main()

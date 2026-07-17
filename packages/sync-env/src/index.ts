#!/usr/bin/env bun
import { multiselect, isCancel } from '@clack/prompts'
import { parse } from 'dotenv'
import { cac } from 'cac'
import { parse as parseJsonc } from 'jsonc-parser'
import { dirname, join, relative, resolve } from 'node:path'

import { banner, fail, info, isInteractive, ok, printVersion, readPackageVersion, step } from './cli-kit'
import { isSecretKey } from './secret-keys'

const ENVIRONMENTS = ['development', 'production'] as const
const TARGETS = ['cloudflare', 'supabase'] as const
type Environment = (typeof ENVIRONMENTS)[number]
type Target = (typeof TARGETS)[number]
type EnvTier = 'multi' | 'single' | 'none'
type CloudflareMode = 'all' | 'vars' | 'secrets'

type ParsedArgs = {
	dryRun: boolean
	envDir: string | null
	envs: Environment[]
	explicitEnv: boolean
	filter: string | null
	mode: CloudflareMode
	skipKeys: Set<string>
	targets: Target[]
}

type CloudflareOptions = {
	dryRun: boolean
	filter: string | null
	mode: CloudflareMode
	skipKeys: Set<string>
}

type CommandResult = {
	exitCode: number
	output: string
}

async function detectTier(envDir: string): Promise<EnvTier> {
	const hasDev = await Bun.file(join(envDir, '.env.development')).exists()
	const hasProd = await Bun.file(join(envDir, '.env.production')).exists()
	if (hasDev || hasProd) return 'multi'
	if (await Bun.file(join(envDir, '.env')).exists()) return 'single'
	return 'none'
}

function expandVars(vars: Record<string, string>): Record<string, string> {
	const expanded: Record<string, string> = {}
	for (const [key, value] of Object.entries(vars)) {
		expanded[key] = value.replace(/\$\{([^}]+)}/g, (_, ref) => vars[ref] ?? '')
	}
	return expanded
}

async function loadEnvFiles(
	envDir: string,
	tier: EnvTier,
	requestedEnvs: Environment[]
): Promise<Record<string, Record<string, string>>> {
	const envVars: Record<string, Record<string, string>> = {}

	if (tier === 'none') return envVars

	if (tier === 'single') {
		const envFile = Bun.file(join(envDir, '.env'))
		if (!(await envFile.exists())) return envVars
		envVars['root'] = expandVars(parse(await envFile.text()))
		info(`  loaded .env (${Object.keys(envVars['root']).length} keys)`)
		return envVars
	}

	for (const env of requestedEnvs) {
		const envFile = Bun.file(join(envDir, `.env.${env}`))
		if (!(await envFile.exists())) {
			info(`  .env.${env} not found, skipping`)
			continue
		}
		envVars[env] = expandVars(parse(await envFile.text()))
		info(`  loaded .env.${env} (${Object.keys(envVars[env]).length} keys)`)
	}

	return envVars
}

async function run(command: string[], cwd: string, stdin?: Blob): Promise<CommandResult> {
	const proc = Bun.spawn(command, { cwd, stdin, stdout: 'pipe', stderr: 'pipe' })
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	])

	return {
		exitCode,
		output: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
	}
}

function redactSecretValues(output: string, environment: Record<string, string>): string {
	const secretValues = Object.entries({ ...process.env, ...environment })
		.filter((entry): entry is [string, string] => {
			const [key, value] = entry
			return Boolean(value && value.length >= 4 && isSecretKey(key))
		})
		.map(([, value]) => value)
		.sort((left, right) => right.length - left.length)

	let redacted = output
	for (const value of secretValues) redacted = redacted.replaceAll(value, '[REDACTED]')
	return redacted
}

function commandFailure(
	platform: 'Cloudflare' | 'Supabase',
	target: string,
	result: CommandResult,
	environment: Record<string, string>
): Error {
	const output = redactSecretValues(result.output, environment)
	const details = output ? `\n${output}` : ''
	return new Error(`${platform} sync failed for ${target} with exit code ${result.exitCode}.${details}`)
}

async function scanEdgeFunctionEnvKeys(rootDir: string): Promise<Set<string>> {
	const functionsDir = join(rootDir, 'supabase/functions')
	const keys = new Set<string>()
	const envGetPattern = /\bDeno\s*\.\s*env\s*\.\s*get\s*\(\s*['"]([^'"]+)['"]\s*\)/g
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

const DEFAULT_CF_SKIP_KEYS = new Set([
	'DOTENV_PUBLIC_KEY',
	'DOTENV_PUBLIC_KEY_DEVELOPMENT',
	'DOTENV_PUBLIC_KEY_PRODUCTION',
	'NODE_OPTIONS'
])

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

export function parseCsvOption(value: string): string[] {
	return value
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
}

function globToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
	return new RegExp(escaped)
}

export function filterWranglerConfigs(configs: string[], rootDir: string, filter: string | null): string[] {
	if (!filter) return configs

	const matcher = filter.includes('*') ? globToRegExp(filter) : null
	return configs.filter((configPath) => {
		const configDir = relative(rootDir, dirname(configPath)) || '.'
		return matcher ? matcher.test(configDir) : configDir.includes(filter)
	})
}

function selectCloudflareVars(allVars: Record<string, string>, skipKeys: Set<string>): Record<string, string> {
	const vars: Record<string, string> = {}
	for (const [key, value] of Object.entries(allVars)) {
		if (!value || skipKeys.has(key) || isSecretKey(key)) continue
		vars[key] = value
	}
	return vars
}

function selectCloudflareSecrets(allVars: Record<string, string>, skipKeys: Set<string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(allVars).filter(([key, value]) => value && isSecretKey(key) && !skipKeys.has(key))
	)
}

function keySummary(vars: Record<string, string>): string {
	const keys = Object.keys(vars).sort()
	return keys.length > 0 ? keys.join(', ') : 'none'
}

async function syncCloudflareForConfig(
	wranglerPath: string,
	envVars: Record<string, Record<string, string>>,
	rootDir: string,
	options: CloudflareOptions
) {
	const displayPath = relative(rootDir, wranglerPath) || 'wrangler.jsonc'
	info(`\n  -- ${displayPath} --`)

	const wrangler = parseJsonc(await Bun.file(wranglerPath).text()) as Record<string, unknown>
	const wranglerDir = dirname(wranglerPath)
	const isRoot = 'root' in envVars

	if (options.mode !== 'secrets') {
		info('    vars (wrangler.jsonc):')
		if (isRoot) {
			const vars = selectCloudflareVars(envVars['root'], options.skipKeys)
			wrangler.vars = vars
			info(`      root: ${Object.keys(vars).length} vars (${keySummary(vars)})`)
		} else {
			const envBlock = (wrangler.env ?? {}) as Record<string, { vars?: Record<string, string> }>
			for (const [env, allVars] of Object.entries(envVars)) {
				const vars = selectCloudflareVars(allVars, options.skipKeys)
				envBlock[env] = { ...envBlock[env], vars }
				info(`      ${env}: ${Object.keys(vars).length} vars (${keySummary(vars)})`)
			}
			wrangler.env = envBlock
		}

		if (options.dryRun) {
			info('      dry-run: would write wrangler.jsonc')
		} else {
			await Bun.write(wranglerPath, JSON.stringify(wrangler, null, '\t') + '\n')
		}
	}

	if (options.mode === 'vars') return

	info('    secrets (bulk upload):')
	for (const [env, allVars] of Object.entries(envVars)) {
		const secrets = selectCloudflareSecrets(allVars, options.skipKeys)
		const count = Object.keys(secrets).length

		if (count === 0) {
			info(`      ${env}: no secrets to push`)
			continue
		}

		if (options.dryRun) {
			info(`      ${env}: dry-run would push ${count} secrets (${keySummary(secrets)})`)
			continue
		}

		const command = ['bunx', 'wrangler', 'versions', 'secret', 'bulk']
		if (env !== 'root') command.push('--env', env)
		const result = await run(command, wranglerDir, new Blob([JSON.stringify(secrets)]))

		if (result.exitCode === 0) {
			info(`      ${env}: ok (${count} secrets)`)
			for (const key of Object.keys(secrets)) ok(key, '        ')
		} else {
			throw commandFailure('Cloudflare', `${displayPath} (${env})`, result, allVars)
		}
	}
}

async function syncCloudflare(
	envVars: Record<string, Record<string, string>>,
	rootDir: string,
	options: CloudflareOptions
) {
	info('\n-- Cloudflare ---------------------------------------\n')

	const discoveredConfigs = await discoverWranglerConfigs(rootDir)
	const configs = filterWranglerConfigs(discoveredConfigs, rootDir, options.filter)

	if (configs.length === 0) {
		info(
			options.filter
				? `  No wrangler.jsonc matched --filter ${options.filter}. Skipping Cloudflare sync.`
				: '  No wrangler.jsonc found. Skipping Cloudflare sync.'
		)
		return
	}

	if (discoveredConfigs.length > 1) {
		info(`  Found ${configs.length} wrangler configs (monorepo mode)`)
	}

	for (const configPath of configs) {
		await syncCloudflareForConfig(configPath, envVars, rootDir, options)
	}
}

async function syncSupabase(
	envVars: Record<string, Record<string, string>>,
	rootDir: string,
	options: { dryRun: boolean }
) {
	const edgeKeys = await scanEdgeFunctionEnvKeys(rootDir)

	info('\n-- Supabase (edge function secrets) -----------------')

	if (edgeKeys.size === 0) {
		info('  No supabase/functions/ found or no Deno.env.get() calls. Skipping.')
		return
	}

	info(`  scanned keys: ${[...edgeKeys].sort().join(', ')}\n`)

	for (const [env, vars] of Object.entries(envVars)) {
		const projectId = vars.SUPABASE_PROJECT_ID
		if (!projectId) {
			info(`  ${env}: skip (no SUPABASE_PROJECT_ID)`)
			continue
		}

		const entries = Object.entries(vars).filter(
			([key, value]) => edgeKeys.has(key) && value && !key.startsWith('SUPABASE_')
		)

		if (entries.length === 0) {
			info(`  ${env}: no secrets to set`)
			continue
		}

		if (options.dryRun) {
			const keys = entries
				.map(([key]) => key)
				.sort()
				.join(', ')
			info(`  ${env}: dry-run would set ${entries.length} secrets (${keys})`)
			continue
		}

		const pairs = entries.map(([key, value]) => `${key}=${value}`)
		const result = await run(['bunx', 'supabase', 'secrets', 'set', ...pairs, '--project-ref', projectId], rootDir)

		if (result.exitCode === 0) {
			info(`  ${env}: ok (${entries.length} secrets)`)
			for (const [key] of entries) ok(key, '    ')
		} else {
			throw commandFailure('Supabase', env, result, vars)
		}
	}
}

function createCli() {
	const cli = cac('sync-env')
	cli.usage('[target] [options]')
	cli.option('--env <env>', 'Environment to sync: development or production')
	cli.option('--env-dir <path>', 'Directory containing env files')
	cli.option('-n, --dry-run', 'Preview changes without writing files or pushing secrets')
	cli.option('--filter <name>', 'Restrict Cloudflare wrangler configs by directory match')
	cli.option('--vars-only', 'Only write Cloudflare vars to wrangler.jsonc')
	cli.option('--secrets-only', 'Only push Cloudflare secrets')
	cli.option('--skip <KEY,...>', 'Additional Cloudflare env keys to skip')
	cli.option('-v, --version', 'Show version')
	cli.example('sync-env cloudflare --env development')
	cli.example('sync-env supabase --env production')
	cli.example('sync-env cloudflare --dry-run --filter app')
	cli.help()
	return cli
}

function printUsageAndExit(message: string): never {
	fail(message)
	createCli().outputHelp()
	process.exit(1)
}

function validateRawOptions(raw: string[]): void {
	const booleanFlags = new Set(['--dry-run', '-n', '--vars-only', '--secrets-only', '--version', '-v', '--help', '-h'])
	const valueFlags = new Set(['--env', '--env-dir', '--filter', '--skip'])

	for (let index = 0; index < raw.length; index++) {
		const arg = raw[index]
		if (!arg.startsWith('-')) continue

		const [flag] = arg.split('=')
		if (booleanFlags.has(flag)) {
			if (arg.includes('=')) printUsageAndExit(`${flag} does not accept a value`)
			continue
		}

		if (valueFlags.has(flag)) {
			if (arg.includes('=')) continue
			const next = raw[index + 1]
			if (!next || next.startsWith('-')) {
				printUsageAndExit(`${flag} requires a value`)
			}
			index++
			continue
		}

		printUsageAndExit(`Unknown option: ${flag}`)
	}
}

function valuesForOption(raw: string[], longFlag: string): string[] {
	const values: string[] = []
	for (let i = 0; i < raw.length; i++) {
		const arg = raw[i]
		if (arg === longFlag && raw[i + 1]) {
			values.push(raw[++i])
			continue
		}
		if (arg.startsWith(`${longFlag}=`)) {
			values.push(arg.slice(longFlag.length + 1))
		}
	}
	return values
}

function readOptionValue(options: Record<string, unknown>, name: string): string | null {
	const value = options[name]
	return typeof value === 'string' && value.trim() ? value : null
}

async function promptTargetsAndEnvs(): Promise<Pick<ParsedArgs, 'envs' | 'targets'>> {
	const targetAnswer = await multiselect<Target>({
		message: 'Select sync targets',
		options: TARGETS.map((target) => ({ label: target, value: target })),
		initialValues: [...TARGETS],
		required: true
	})
	if (isCancel(targetAnswer)) process.exit(1)

	const envAnswer = await multiselect<Environment>({
		message: 'Select environments',
		options: ENVIRONMENTS.map((env) => ({ label: env, value: env })),
		initialValues: [...ENVIRONMENTS],
		required: true
	})
	if (isCancel(envAnswer)) process.exit(1)

	return {
		envs: envAnswer,
		targets: targetAnswer
	}
}

async function parseArgs(version: string): Promise<ParsedArgs | null> {
	const raw = process.argv.slice(2)
	validateRawOptions(raw)

	const cli = createCli()
	const parsed = cli.parse(process.argv, { run: false })
	const options = parsed.options

	if (options.help || options.h) return null
	if (options.version || options.v) {
		printVersion('sync-env', version)
		return null
	}

	if (raw.length === 0) {
		if (!isInteractive()) {
			printUsageAndExit('sync-env requires a target or options in non-interactive mode.')
		}

		const prompted = await promptTargetsAndEnvs()
		return {
			...prompted,
			dryRun: false,
			envDir: null,
			explicitEnv: true,
			filter: null,
			mode: 'all',
			skipKeys: new Set(DEFAULT_CF_SKIP_KEYS)
		}
	}

	const targets = parsed.args.map(String)
	const invalidTarget = targets.find((target): target is string => !TARGETS.includes(target as Target))
	if (invalidTarget) {
		printUsageAndExit(`Invalid target "${invalidTarget}". Expected: ${TARGETS.join(', ')}`)
	}

	const envValues = valuesForOption(raw, '--env')
	const invalidEnv = envValues.find((env): env is string => !ENVIRONMENTS.includes(env as Environment))
	if (invalidEnv) {
		printUsageAndExit(`Invalid --env "${invalidEnv}". Expected: ${ENVIRONMENTS.join(', ')}`)
	}

	if (options.varsOnly && options.secretsOnly) {
		printUsageAndExit('--vars-only cannot be used with --secrets-only')
	}

	const skipKeys = new Set(DEFAULT_CF_SKIP_KEYS)
	for (const value of valuesForOption(raw, '--skip')) {
		for (const key of parseCsvOption(value)) skipKeys.add(key)
	}

	return {
		dryRun: Boolean(options.dryRun || options.n),
		envDir: readOptionValue(options, 'envDir'),
		envs: envValues.length > 0 ? (envValues as Environment[]) : [...ENVIRONMENTS],
		explicitEnv: envValues.length > 0,
		filter: readOptionValue(options, 'filter'),
		mode: options.varsOnly ? 'vars' : options.secretsOnly ? 'secrets' : 'all',
		skipKeys,
		targets: targets.length > 0 ? (targets as Target[]) : [...TARGETS]
	}
}

async function main() {
	const start = performance.now()
	const version = await readPackageVersion()
	const args = await parseArgs(version)
	if (!args) return

	banner('sync-env', version, 'Sync env vars to platform secrets')

	const rootDir = process.cwd()
	const resolvedEnvDir = args.envDir ? resolve(rootDir, args.envDir) : rootDir
	const tier = args.explicitEnv ? 'multi' : await detectTier(resolvedEnvDir)

	info(`Env tier: ${tier}`)
	info(`Env dir: ${relative(rootDir, resolvedEnvDir) || '.'}`)
	info(`Syncing env vars -> ${args.targets.join(', ')}`)
	if (args.dryRun) step('dry-run: no files will be written and no secrets will be pushed')

	if (tier === 'none') {
		info('\nNo env files found. Nothing to sync.')
		return
	}

	if (args.explicitEnv) {
		for (const env of args.envs) {
			const envFile = Bun.file(join(resolvedEnvDir, `.env.${env}`))
			if (!(await envFile.exists())) {
				fail(`Error: .env.${env} not found in ${resolvedEnvDir} (--env ${env} was explicitly requested)`)
				process.exit(1)
			}
		}
	}

	const envVars = await loadEnvFiles(resolvedEnvDir, tier, args.envs)

	if (Object.keys(envVars).length === 0) {
		info('\nNo env files loaded. Nothing to sync.')
		return
	}

	if (args.targets.includes('cloudflare')) {
		await syncCloudflare(envVars, rootDir, {
			dryRun: args.dryRun,
			filter: args.filter,
			mode: args.mode,
			skipKeys: args.skipKeys
		})
	}

	if (args.targets.includes('supabase')) {
		await syncSupabase(envVars, rootDir, { dryRun: args.dryRun })
	}

	const elapsed = ((performance.now() - start) / 1000).toFixed(1)
	info(`\nDone in ${elapsed}s.`)
}

if (import.meta.main) {
	main().catch((error) => {
		fail(error instanceof Error ? error.message : String(error))
		process.exit(1)
	})
}

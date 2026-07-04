#!/usr/bin/env bun
import { parse } from '@dotenvx/dotenvx'
import { cac } from 'cac'
import { appendFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import { banner, fail, info, printVersion, readPackageVersion } from './cli-kit'

type Exists = (path: string) => Promise<boolean>

type ResolveEnvFileOptions = {
	envDir: string
	environment?: string | null
	envFile?: string | null
	exists?: Exists
}

type Args = {
	envDir: string | null
	envFile: string | null
	environment: string | null
	outputKeys: string[]
	quiet: boolean
}

type ExportGithubEnvOptions = {
	githubEnv: string | null | undefined
	githubOutput?: string | null
	outputKeys: string[]
	writeCommand?: (command: string) => void
}

const BLOCKED_ENV_KEYS = ['NODE_OPTIONS'] as const
const BLOCKED_ENV_PREFIXES = ['ACTIONS_', 'GITHUB_', 'RUNNER_'] as const

function createCli() {
	const cli = cac('github-env')
	cli.usage('[options]')
	cli.option('--environment <name>', 'Environment name, resolves .env.<name>')
	cli.option('--env-dir <path>', 'Directory containing env files (default: current directory)')
	cli.option('--env-file <file>', 'Explicit env file to load, relative to --env-dir')
	cli.option('--outputs <KEY,...>', 'Comma-separated keys to expose as step outputs')
	cli.option('-q, --quiet', 'Suppress banner and success output')
	cli.option('-v, --version', 'Show version')
	cli.example('github-env --environment production')
	cli.example('github-env --environment production --outputs AWS_REGION,AWS_ACCOUNT_ID')
	cli.example('github-env --env-file config/smoke.env --outputs AWS_REGION')
	cli.help()
	return cli
}

function printUsageAndExit(message: string): never {
	fail(message)
	createCli().outputHelp()
	process.exit(1)
}

function validateRawOptions(raw: string[]): void {
	const booleanFlags = new Set(['--quiet', '-q', '--version', '-v', '--help', '-h'])
	const valueFlags = new Set(['--environment', '--env-dir', '--env-file', '--outputs'])

	for (let index = 0; index < raw.length; index++) {
		const arg = raw[index]
		if (!arg.startsWith('-')) {
			printUsageAndExit(`Unexpected argument: ${arg}`)
		}

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

function optionalString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null
}

function parseArgs(version: string): Args | null {
	validateRawOptions(process.argv.slice(2))

	const cli = createCli()
	const parsed = cli.parse(process.argv, { run: false })
	const options = parsed.options

	if (options.help || options.h) return null
	if (options.version || options.v) {
		printVersion('github-env', version)
		return null
	}

	if (parsed.args.length > 0) {
		printUsageAndExit(`Unexpected argument: ${parsed.args[0]}`)
	}

	const environment = optionalString(options.environment)
	const envFile = optionalString(options.envFile)
	if (environment && envFile) {
		printUsageAndExit('--environment and --env-file cannot be used together')
	}

	return {
		envDir: optionalString(options.envDir),
		envFile,
		environment,
		outputKeys: parseOutputKeys(optionalString(options.outputs)),
		quiet: Boolean(options.quiet || options.q)
	}
}

export function parseOutputKeys(value: string | null): string[] {
	if (!value) return []

	const keys: string[] = []
	const seen = new Set<string>()
	for (const key of value.split(',').map((item) => item.trim())) {
		if (!key || seen.has(key)) continue
		validateEnvKey(key, 'output key')
		seen.add(key)
		keys.push(key)
	}

	return keys
}

function validateEnvKey(key: string, label: string): void {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
		throw new Error(`Invalid ${label}: ${key}`)
	}
}

function isDotenvxMetadataKey(key: string): boolean {
	return (
		key === 'DOTENV_PUBLIC_KEY' ||
		key === 'DOTENV_PRIVATE_KEY' ||
		key.startsWith('DOTENV_PUBLIC_KEY_') ||
		key.startsWith('DOTENV_PRIVATE_KEY_')
	)
}

export function parseEnvContent(src: string): Record<string, string> {
	const parsed = parse(src, { processEnv: {} })
	const env: Record<string, string> = {}

	for (const [key, value] of Object.entries(parsed)) {
		validateEnvKey(key, 'env key')
		if (!isDotenvxMetadataKey(key)) {
			env[key] = value
		}
	}

	return env
}

async function defaultExists(path: string): Promise<boolean> {
	return Bun.file(path).exists()
}

export async function resolveEnvFile(options: ResolveEnvFileOptions): Promise<string> {
	const exists = options.exists ?? defaultExists
	const envDir = resolve(options.envDir)
	const requested = options.envFile
		? resolve(envDir, options.envFile)
		: options.environment
			? join(envDir, `.env.${options.environment}`)
			: join(envDir, '.env')

	if (!(await exists(requested))) {
		const display = relative(process.cwd(), requested) || requested
		throw new Error(`Env file not found: ${display}`)
	}

	return requested
}

function assertWritableEnvKey(key: string): void {
	if (
		BLOCKED_ENV_KEYS.includes(key as (typeof BLOCKED_ENV_KEYS)[number]) ||
		BLOCKED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
	) {
		throw new Error(`Cannot write GitHub-reserved env key: ${key}`)
	}
}

function outputNameForKey(key: string): string {
	return key.toLowerCase()
}

function escapeWorkflowCommandData(value: string): string {
	return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}

function maskValue(value: string, writeCommand: (command: string) => void): void {
	for (const line of value.split(/\r?\n/)) {
		if (line.length > 0) {
			writeCommand(`::add-mask::${escapeWorkflowCommandData(line)}`)
		}
	}
}

function delimiterFor(key: string, value: string): string {
	let delimiter = `github_env_${key}_${randomUUID()}`
	while (value.includes(delimiter)) {
		delimiter = `github_env_${key}_${randomUUID()}`
	}
	return delimiter
}

function formatGithubFileEntry(key: string, value: string): string {
	if (value.includes('\n') || value.includes('\r')) {
		const delimiter = delimiterFor(key, value)
		return `${key}<<${delimiter}\n${value}\n${delimiter}\n`
	}

	return `${key}=${value}\n`
}

async function appendGithubFile(
	path: string | null | undefined,
	key: string,
	value: string,
	label: string
): Promise<void> {
	if (!path) {
		throw new Error(`${label} is not set`)
	}

	await appendFile(path, formatGithubFileEntry(key, value))
}

export async function exportGithubEnv(env: Record<string, string>, options: ExportGithubEnvOptions): Promise<void> {
	const writeCommand = options.writeCommand ?? ((command) => console.log(command))
	const entries = Object.entries(env).sort(([left], [right]) => left.localeCompare(right))

	if (!options.githubEnv) {
		throw new Error('GITHUB_ENV is not set')
	}

	if (options.outputKeys.length > 0 && !options.githubOutput) {
		throw new Error('GITHUB_OUTPUT is not set')
	}

	for (const [key] of entries) {
		assertWritableEnvKey(key)
	}

	for (const key of options.outputKeys) {
		validateEnvKey(key, 'output key')
		if (!Object.hasOwn(env, key)) {
			throw new Error(`Requested output key not found: ${key}`)
		}
		assertWritableEnvKey(key)
	}

	for (const [, value] of entries) {
		maskValue(value, writeCommand)
	}

	for (const [key, value] of entries) {
		await appendGithubFile(options.githubEnv, key, value, 'GITHUB_ENV')
	}

	for (const key of options.outputKeys) {
		await appendGithubFile(options.githubOutput, outputNameForKey(key), env[key], 'GITHUB_OUTPUT')
	}
}

async function main() {
	const version = await readPackageVersion()
	const args = parseArgs(version)
	if (!args) return

	banner('github-env', version, 'Load dotenv files into GitHub Actions', {
		quiet: args.quiet
	})

	const rootDir = process.cwd()
	const envDir = args.envDir ? resolve(rootDir, args.envDir) : rootDir
	const envFile = await resolveEnvFile({
		envDir,
		envFile: args.envFile,
		environment: args.environment
	})
	const env = parseEnvContent(await Bun.file(envFile).text())

	await exportGithubEnv(env, {
		githubEnv: process.env.GITHUB_ENV,
		githubOutput: process.env.GITHUB_OUTPUT,
		outputKeys: args.outputKeys
	})

	if (!args.quiet) {
		const envLabel = relative(rootDir, envFile) || envFile
		const outputCount = args.outputKeys.length
		info(`github-env: loaded ${Object.keys(env).length} keys from ${envLabel}; wrote ${outputCount} outputs.`)
	}
}

if (import.meta.main) {
	main().catch((error) => {
		fail(error instanceof Error ? error.message : String(error))
		process.exit(1)
	})
}

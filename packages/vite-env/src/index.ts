#!/usr/bin/env bun
import { cac } from 'cac'
import { join, relative, resolve } from 'node:path'

import { banner, fail, info, printVersion, readPackageVersion } from './cli-kit'

const DEFAULT_OUT_FILE = join('src', 'vite-env.d.ts')
const DEFAULT_PREFIX = 'VITE_'

type Args = {
	envDir: string | null
	envFile: string | null
	out: string
	prefix: string
}

function createCli() {
	const cli = cac('vite-env')
	cli.usage('[options]')
	cli.option('--env-dir <path>', 'Directory containing env files (default: current directory)')
	cli.option('--env-file <file>', 'Env file to read variables from, for example .env.development')
	cli.option('--output <file>', 'Output declaration file', {
		default: DEFAULT_OUT_FILE,
	})
	cli.option('--prefix <prefix>', 'Environment variable prefix to scan', {
		default: DEFAULT_PREFIX,
	})
	cli.option('-v, --version', 'Show version')
	cli.example('vite-env')
	cli.example('vite-env --env-file .env.development')
	cli.example('vite-env --output src/env.d.ts --prefix PUBLIC_')
	cli.help()
	return cli
}

function printUsageAndExit(message: string): never {
	fail(message)
	createCli().outputHelp()
	process.exit(1)
}

function validateRawOptions(raw: string[]): void {
	const booleanFlags = new Set(['--version', '-v', '--help', '-h'])
	// --out is kept as a hidden alias of --output for backward compatibility.
	const valueFlags = new Set([
		'--env-dir',
		'--env-file',
		'--output',
		'--out',
		'--prefix',
	])

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

function readOptionValue(
	options: Record<string, unknown>,
	name: string,
	fallback: string,
): string {
	const value = options[name]
	return typeof value === 'string' && value.trim() ? value : fallback
}

function parseArgs(version: string): Args | null {
	validateRawOptions(process.argv.slice(2))

	const cli = createCli()
	const parsed = cli.parse(process.argv, { run: false })
	const options = parsed.options

	if (options.help || options.h) return null
	if (options.version || options.v) {
		printVersion('vite-env', version)
		return null
	}

	if (parsed.args.length > 0) {
		printUsageAndExit(`Unexpected argument: ${parsed.args[0]}`)
	}

	const prefix = readOptionValue(options, 'prefix', DEFAULT_PREFIX)
	if (!prefix) printUsageAndExit('--prefix cannot be empty')

	// cac exposes --env-dir as options.envDir, --env-file as options.envFile,
	// and --output as options.output (always populated, defaulting to
	// DEFAULT_OUT_FILE). The --out alias is undeclared, so options.out is only
	// present when the user actually passed it — prefer it when set.
	const out =
		optionalString(options.out) ??
		readOptionValue(options, 'output', DEFAULT_OUT_FILE)

	return {
		envDir: optionalString(options.envDir),
		envFile: optionalString(options.envFile),
		out,
		prefix,
	}
}

function optionalString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null
}

async function detectEnvFile(envDir: string): Promise<string | null> {
	const envDev = join(envDir, '.env.development')
	const envRoot = join(envDir, '.env')
	return (await Bun.file(envDev).exists())
		? envDev
		: (await Bun.file(envRoot).exists())
			? envRoot
			: null
}

function envKeyFromLine(line: string): string | null {
	const trimmed = line.trimStart()
	const assignment = trimmed.startsWith('export ')
		? trimmed.slice('export '.length).trimStart()
		: trimmed
	const match = assignment.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/)

	return match?.[1] ?? null
}

/** Extract declared variable names from a dotenv file body, in file order. */
export function envKeysFromFile(src: string): string[] {
	const keys: string[] = []
	const seen = new Set<string>()

	for (const line of src.split(/\r?\n/)) {
		const key = envKeyFromLine(line)
		if (key && !seen.has(key)) {
			seen.add(key)
			keys.push(key)
		}
	}

	return keys
}

export function envKeysForPrefix(
	env: NodeJS.ProcessEnv,
	prefix: string,
): string[] {
	return Object.keys(env)
		.filter((key) => key.startsWith(prefix))
		.sort()
}

function filterByPrefix(keys: string[], prefix: string): string[] {
	return [...new Set(keys.filter((key) => key.startsWith(prefix)))].sort()
}

export function renderViteEnvDeclaration(keys: string[]): string {
	return `// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface ViteTypeOptions {
	strictImportMetaEnv: unknown
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface ImportMetaEnv {
${keys.map((key) => `\treadonly ${key}: string`).join('\n')}
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface ImportMeta {
	readonly env: ImportMetaEnv
}
`
}

async function main() {
	const version = await readPackageVersion()
	const args = parseArgs(version)
	if (!args) return

	banner('vite-env', version, 'Generate typed env declarations')

	const rootDir = process.cwd()
	const envDir = args.envDir ? resolve(rootDir, args.envDir) : rootDir

	// Resolve which env file (if any) to read variable names from. An explicit
	// --env-file wins; otherwise fall back to the .env.development / .env probe.
	let envFile: string | null = null
	if (args.envFile) {
		envFile = resolve(envDir, args.envFile)
		if (!(await Bun.file(envFile).exists())) {
			fail(`Env file not found: ${relative(rootDir, envFile) || args.envFile}`)
			process.exit(1)
		}
	} else {
		envFile = await detectEnvFile(envDir)
	}

	if (!envFile) {
		info('Skipping vite-env generation (no .env.development or .env found)')
		return
	}

	// File-first: read variable names from the env file itself. Fall back to
	// process.env so the legacy `bun --env-file=... bunx vite-env` flow still
	// works when no file is present on disk.
	const fileKeys = filterByPrefix(
		envKeysFromFile(await Bun.file(envFile).text()),
		args.prefix,
	)
	const keys =
		fileKeys.length > 0
			? fileKeys
			: envKeysForPrefix(process.env, args.prefix)

	if (keys.length === 0) {
		info(`No ${args.prefix} environment variables found, skipping generation`)
		return
	}

	const outFile = resolve(rootDir, args.out)
	await Bun.write(outFile, renderViteEnvDeclaration(keys))
	info(`Generated ${relative(rootDir, outFile) || '.'}`)
}

if (import.meta.main) {
	main().catch((error) => {
		fail(error instanceof Error ? error.message : String(error))
		process.exit(1)
	})
}

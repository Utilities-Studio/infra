#!/usr/bin/env bun
import { cac } from 'cac'
import { join, relative, resolve } from 'node:path'

import { banner, fail, info, printVersion, readPackageVersion } from './cli-kit'

const DEFAULT_OUT_FILE = join('src', 'vite-env.d.ts')
const DEFAULT_PREFIX = 'VITE_'

type Args = {
	out: string
	prefix: string
}

function createCli() {
	const cli = cac('vite-env')
	cli.usage('[options]')
	cli.option('--out <file>', 'Output declaration file', {
		default: DEFAULT_OUT_FILE,
	})
	cli.option('--prefix <prefix>', 'Environment variable prefix to scan', {
		default: DEFAULT_PREFIX,
	})
	cli.option('-v, --version', 'Show version')
	cli.example('vite-env')
	cli.example('vite-env --out src/env.d.ts --prefix PUBLIC_')
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
	const valueFlags = new Set(['--out', '--prefix'])

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

	return {
		out: readOptionValue(options, 'out', DEFAULT_OUT_FILE),
		prefix,
	}
}

async function detectEnvFile(rootDir: string): Promise<string | null> {
	const envDev = join(rootDir, '.env.development')
	const envRoot = join(rootDir, '.env')
	return (await Bun.file(envDev).exists())
		? envDev
		: (await Bun.file(envRoot).exists())
			? envRoot
			: null
}

export function envKeysForPrefix(
	env: NodeJS.ProcessEnv,
	prefix: string,
): string[] {
	return Object.keys(env)
		.filter((key) => key.startsWith(prefix))
		.sort()
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
	const envFile = await detectEnvFile(rootDir)

	if (!envFile) {
		info('Skipping vite-env generation (no .env.development or .env found)')
		return
	}

	const keys = envKeysForPrefix(process.env, args.prefix)

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

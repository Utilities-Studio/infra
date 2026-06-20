#!/usr/bin/env bun
import { parse } from '@dotenvx/dotenvx'
import { cac } from 'cac'
import { join, relative, resolve } from 'node:path'

import { banner, printVersion, readPackageVersion } from './cli-kit'

const DEFAULT_ENV_FILES = ['.env', '.env.development', '.env.production'] as const
const LOCAL_DOTENVX_BIN = join(
	import.meta.dir,
	'..',
	'node_modules',
	'.bin',
	process.platform === 'win32' ? 'dotenvx.cmd' : 'dotenvx',
)

export type DiffKind = 'added' | 'removed' | 'changed'

export type Diff = {
	key: string
	kind: DiffKind
}

type Args = {
	check: boolean
	envDir: string | null
	files: string[]
	quiet: boolean
	stage: boolean
}

type RunResult = {
	exitCode: number
	stderr: string
	stdout: string
}

export function parseEnvFileList(value: string): string[] {
	return value
		.split(',')
		.map((file) => file.trim())
		.filter((file) => file.length > 0)
}

function createCli() {
	const cli = cac('env-encrypt')
	cli.usage('[options]')
	cli.option('--env-dir <path>', 'Directory containing env files (default: current directory)')
	cli.option('--files <name,...>', 'Comma-separated env files to scan')
	cli.option('--check', 'Compare only; exit 1 when encrypted files are out of date')
	cli.option('--stage', 'git add changed .encrypted files after encrypting')
	cli.option('-q, --quiet', 'Suppress banner and no-change output')
	cli.option('-v, --version', 'Show version')
	cli.example('env-encrypt')
	cli.example('env-encrypt --stage')
	cli.example('env-encrypt --check --files .env,.env.preview')
	cli.help()
	return cli
}

function printUsageAndExit(message: string): never {
	console.error(message)
	createCli().outputHelp()
	process.exit(1)
}

function validateRawOptions(raw: string[]): void {
	const booleanFlags = new Set([
		'--check',
		'--stage',
		'--quiet',
		'-q',
		'--version',
		'-v',
		'--help',
		'-h',
	])
	const valueFlags = new Set(['--env-dir', '--files'])

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
): string | null {
	const value = options[name]
	return typeof value === 'string' && value.trim() ? value : null
}

function parseArgs(version: string): Args | null {
	validateRawOptions(process.argv.slice(2))

	const cli = createCli()
	const parsed = cli.parse(process.argv, { run: false })
	const options = parsed.options

	if (options.help || options.h) return null
	if (options.version || options.v) {
		printVersion('env-encrypt', version)
		return null
	}

	if (parsed.args.length > 0) {
		printUsageAndExit(`Unexpected argument: ${parsed.args[0]}`)
	}

	const filesOption = readOptionValue(options, 'files')

	return {
		check: Boolean(options.check),
		envDir: readOptionValue(options, 'envDir'),
		files: filesOption ? parseEnvFileList(filesOption) : [...DEFAULT_ENV_FILES],
		quiet: Boolean(options.quiet || options.q),
		stage: Boolean(options.stage),
	}
}

function isCiEnvironment(): boolean {
	return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
}

function isDotenvxMetadataKey(key: string): boolean {
	return (
		key === 'DOTENV_PUBLIC_KEY' ||
		key === 'DOTENV_PRIVATE_KEY' ||
		key.startsWith('DOTENV_PUBLIC_KEY_') ||
		key.startsWith('DOTENV_PRIVATE_KEY_')
	)
}

export function parseEnv(src: string): Record<string, string> {
	const parsed = parse(src, { processEnv: {} })
	const env: Record<string, string> = {}

	for (const [key, value] of Object.entries(parsed)) {
		if (!isDotenvxMetadataKey(key)) {
			env[key] = value
		}
	}

	return env
}

export function diffEnv(
	encrypted: Record<string, string>,
	plaintext: Record<string, string>,
): Diff[] {
	const keys = new Set([...Object.keys(encrypted), ...Object.keys(plaintext)])
	const diffs: Diff[] = []

	for (const key of [...keys].sort()) {
		const hasEncrypted = Object.hasOwn(encrypted, key)
		const hasPlaintext = Object.hasOwn(plaintext, key)

		if (!hasEncrypted && hasPlaintext) {
			diffs.push({ key, kind: 'added' })
		} else if (hasEncrypted && !hasPlaintext) {
			diffs.push({ key, kind: 'removed' })
		} else if (encrypted[key] !== plaintext[key]) {
			diffs.push({ key, kind: 'changed' })
		}
	}

	return diffs
}

function displayPath(rootDir: string, filePath: string): string {
	return relative(rootDir, filePath) || '.'
}

async function fileExists(filePath: string): Promise<boolean> {
	return Bun.file(filePath).exists()
}

async function run(command: string[], cwd: string): Promise<RunResult> {
	try {
		const proc = Bun.spawn(command, {
			cwd,
			env: {
				...process.env,
				DOTENVX_NO_OPS: 'true',
			},
			stdout: 'pipe',
			stderr: 'pipe',
		})

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		])

		return { exitCode, stdout, stderr }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return {
			exitCode: 127,
			stdout: '',
			stderr: message,
		}
	}
}

async function runDotenvx(args: string[], cwd: string): Promise<string> {
	const dotenvx = (await fileExists(LOCAL_DOTENVX_BIN)) ? LOCAL_DOTENVX_BIN : 'dotenvx'
	const result = await run([dotenvx, ...args], cwd)

	if (result.exitCode !== 0) {
		const detail = (result.stderr || result.stdout).trim()
		const command = `dotenvx ${args.join(' ')}`
		throw new Error(detail ? `${command}\n${detail}` : `${command} failed`)
	}

	return result.stdout
}

function printDiff(envName: string, diffs: Diff[]) {
	console.log(`${envName} changed:`)
	for (const diff of diffs) {
		console.log(`  ${diff.key} ${diff.kind}`)
	}
}

async function encryptEnvFile(envPath: string, encryptedPath: string, envDir: string) {
	const encrypted = await runDotenvx(
		['encrypt', '-f', envPath, '--stdout', '--no-ops'],
		envDir,
	)
	await Bun.write(encryptedPath, encrypted.endsWith('\n') ? encrypted : `${encrypted}\n`)
}

async function stageFiles(files: string[], rootDir: string) {
	if (files.length === 0) return

	const result = await run(['git', 'add', '--', ...files], rootDir)
	if (result.exitCode !== 0) {
		const detail = (result.stderr || result.stdout).trim()
		throw new Error(detail ? `git add failed\n${detail}` : 'git add failed')
	}
}

async function main() {
	const start = performance.now()
	const version = await readPackageVersion()
	const args = parseArgs(version)
	if (!args) return

	const rootDir = process.cwd()
	const envDir = args.envDir ? resolve(rootDir, args.envDir) : rootDir

	if (args.check && args.stage) {
		console.error('--stage cannot be used with --check')
		process.exit(1)
	}

	if (args.stage && isCiEnvironment()) {
		console.log('env-encrypt: skipping --stage in CI.')
		return
	}

	banner('env-encrypt', version, 'Encrypt changed dotenvx files', {
		quiet: args.quiet,
	})

	let scanned = 0
	let outOfDate = false
	const encryptedFilesToStage: string[] = []

	for (const envName of args.files) {
		const envPath = join(envDir, envName)
		if (!(await fileExists(envPath))) continue

		scanned++

		const encryptedPath = `${envPath}.encrypted`
		const plaintext = parseEnv(await Bun.file(envPath).text())
		let diffs: Diff[] = []

		if (await fileExists(encryptedPath)) {
			const decrypted = await runDotenvx(
				['decrypt', '-f', encryptedPath, '--stdout', '--no-ops'],
				envDir,
			)
			diffs = diffEnv(parseEnv(decrypted), plaintext)
		} else {
			diffs = Object.keys(plaintext)
				.sort()
				.map((key) => ({ key, kind: 'added' as const }))
		}

		if (diffs.length === 0) continue

		outOfDate = true
		printDiff(envName, diffs)

		if (args.check) continue

		await encryptEnvFile(envPath, encryptedPath, envDir)
		if (!args.quiet) console.log(`encrypted ${displayPath(rootDir, encryptedPath)}`)
		encryptedFilesToStage.push(encryptedPath)
	}

	if (scanned === 0) {
		if (!args.quiet) {
			console.log(`env-encrypt: no ${args.files.join(', ')} files found.`)
		}
		return
	}

	if (args.check) {
		if (outOfDate) {
			console.log('env-encrypt: encrypted env files are out of date.')
			process.exit(1)
		}
		if (!args.quiet) console.log('env-encrypt: encrypted env files are current.')
		return
	}

	if (args.stage) {
		await stageFiles(encryptedFilesToStage, rootDir)
		if (encryptedFilesToStage.length > 0) {
			console.log(`staged ${encryptedFilesToStage.length} encrypted file(s)`)
		}
	}

	if (!outOfDate) {
		if (!args.quiet) console.log('env-encrypt: encrypted env files are current.')
		return
	}

	const elapsed = ((performance.now() - start) / 1000).toFixed(1)
	if (!args.quiet) console.log(`env-encrypt: done in ${elapsed}s.`)
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	})
}

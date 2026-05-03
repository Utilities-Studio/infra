#!/usr/bin/env bun
import { parse } from '@dotenvx/dotenvx'
import { join, relative, resolve } from 'node:path'

const ENV_FILES = ['.env', '.env.development', '.env.production'] as const
const LOCAL_DOTENVX_BIN = join(
	import.meta.dir,
	'..',
	'node_modules',
	'.bin',
	process.platform === 'win32' ? 'dotenvx.cmd' : 'dotenvx',
)

type DiffKind = 'added' | 'removed' | 'changed'

type Diff = {
	key: string
	kind: DiffKind
}

type Args = {
	check: boolean
	envDir: string | null
	stage: boolean
}

type RunResult = {
	exitCode: number
	stderr: string
	stdout: string
}

function usage(exitCode = 0): never {
	console.log(`Usage: env-encrypt [options]

Checks .env, .env.development, and .env.production when they exist.
Compares each plaintext file to its matching .encrypted file.
Encrypts only files whose parsed key/value pairs changed.

Options:
  --env-dir <path>  Directory containing env files (default: current directory)
  --check           Compare only; exit 1 when encrypted files are out of date
  --stage           git add changed .encrypted files after encrypting
  -h, --help        Show help`)
	process.exit(exitCode)
}

function parseArgs(): Args {
	const raw = process.argv.slice(2)
	const args: Args = {
		check: false,
		envDir: null,
		stage: false,
	}

	for (let i = 0; i < raw.length; i++) {
		const arg = raw[i]

		if (arg === '--check') {
			args.check = true
		} else if (arg === '--stage') {
			args.stage = true
		} else if (arg === '--env-dir' && raw[i + 1]) {
			args.envDir = raw[++i]
		} else if (arg === '-h' || arg === '--help') {
			usage()
		} else {
			console.error(`Unknown option: ${arg}`)
			usage(1)
		}
	}

	return args
}

function isDotenvxMetadataKey(key: string): boolean {
	return (
		key === 'DOTENV_PUBLIC_KEY' ||
		key === 'DOTENV_PRIVATE_KEY' ||
		key.startsWith('DOTENV_PUBLIC_KEY_') ||
		key.startsWith('DOTENV_PRIVATE_KEY_')
	)
}

function parseEnv(src: string): Record<string, string> {
	const parsed = parse(src)
	const env: Record<string, string> = {}

	for (const [key, value] of Object.entries(parsed)) {
		if (!isDotenvxMetadataKey(key)) {
			env[key] = value
		}
	}

	return env
}

function diffEnv(
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
	const args = parseArgs()
	const rootDir = process.cwd()
	const envDir = args.envDir ? resolve(rootDir, args.envDir) : rootDir

	if (args.check && args.stage) {
		console.error('--stage cannot be used with --check')
		process.exit(1)
	}

	let scanned = 0
	let outOfDate = false
	const encryptedFilesToStage: string[] = []

	for (const envName of ENV_FILES) {
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
		console.log(`encrypted ${displayPath(rootDir, encryptedPath)}`)
		encryptedFilesToStage.push(encryptedPath)
	}

	if (scanned === 0) {
		console.log('env-encrypt: no .env, .env.development, or .env.production files found.')
		return
	}

	if (args.check) {
		if (outOfDate) {
			console.log('env-encrypt: encrypted env files are out of date.')
			process.exit(1)
		}
		console.log('env-encrypt: encrypted env files are current.')
		return
	}

	if (args.stage) {
		await stageFiles(encryptedFilesToStage, rootDir)
		if (encryptedFilesToStage.length > 0) {
			console.log(`staged ${encryptedFilesToStage.length} encrypted file(s)`)
		}
	}

	if (!outOfDate) {
		console.log('env-encrypt: encrypted env files are current.')
		return
	}

	const elapsed = ((performance.now() - start) / 1000).toFixed(1)
	console.log(`env-encrypt: done in ${elapsed}s.`)
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
})

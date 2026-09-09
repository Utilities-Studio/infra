import { compareVersions } from 'compare-versions'
import { z } from 'zod'

import {
	createTrustArguments,
	interactiveTrustArguments,
	listTrustArguments,
	matchesTrustTarget,
	parseCreatedTrust,
	parseTrustList,
	revokeTrustArguments,
	type TrustConfiguration,
	type TrustTarget,
} from './trust'

const npmVersionSchema = z.string().trim().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)

type CommandResult = {
	exitCode: number
	stderr: string
	stdout: string
}

function npmExecutable(cwd: string): string {
	return Bun.which('npm', { cwd, PATH: process.env.PATH ?? '' }) ?? 'npm'
}

async function runNpm(args: string[], cwd: string): Promise<CommandResult> {
	try {
		const child = Bun.spawn([npmExecutable(cwd), ...args], {
			cwd,
			env: process.env,
			stdin: 'inherit',
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		])

		return { exitCode, stderr, stdout }
	} catch {
		return { exitCode: 127, stderr: '', stdout: '' }
	}
}

function npmFailure(operation: 'access check' | 'configuration' | 'revocation', packageName: string, result: CommandResult): Error {
	const output = result.stderr

	if (/ENEEDAUTH|EOTP|\b401\b/i.test(output)) {
		return new Error(
			`${packageName}: npm authentication or 2FA failed. Run npm login, then retry interactively.`,
		)
	}
	if (/E403|\b403\b/i.test(output)) {
		return new Error(`${packageName}: the current npm account does not have package write access.`)
	}
	if (/E404|\b404\b/i.test(output)) {
		return new Error(`${packageName}: package not found. Publish its first version manually, then retry.`)
	}
	if (/E429|\b429\b/i.test(output)) {
		return new Error(`${packageName}: npm rate limit reached. Wait, then rerun the command.`)
	}
	if (/E5\d\d|\b5\d\d\b/i.test(output)) {
		return new Error(`${packageName}: npm is temporarily unavailable. Rerun the command later.`)
	}

	return new Error(`${packageName}: npm trust ${operation} failed with exit code ${result.exitCode}.`)
}

export async function ensureSupportedNpm(cwd: string): Promise<string> {
	const result = await runNpm(['--version'], cwd)
	if (result.exitCode !== 0) {
		throw new Error('npm is unavailable. Install npm 11.15 or newer and retry.')
	}

	const parsed = npmVersionSchema.safeParse(result.stdout)
	if (!parsed.success) throw new Error('npm returned an unsupported version value.')

	const version = parsed.data
	if (!isSupportedNpmVersion(version)) {
		throw new Error(`npm ${version} is unsupported. Use npm >=11.15.0 and <13.0.0.`)
	}

	return version
}

export function isSupportedNpmVersion(version: string): boolean {
	return compareVersions(version, '11.15.0') >= 0 && compareVersions(version, '13.0.0-0') < 0
}

export async function unlockNpmTrust(packageName: string, cwd: string): Promise<void> {
	let exitCode: number
	try {
		const child = Bun.spawn([npmExecutable(cwd), ...interactiveTrustArguments(packageName)], {
			cwd,
			env: process.env,
			stdin: 'inherit',
			stdout: 'inherit',
			stderr: 'inherit',
		})
		exitCode = await child.exited
	} catch {
		exitCode = 127
	}

	if (exitCode !== 0) {
		throw new Error(
			`${packageName}: npm access check failed. Run npm login, confirm package write access, and retry.`,
		)
	}
}

export async function listPackageTrust(
	packageName: string,
	cwd: string,
): Promise<TrustConfiguration[]> {
	const result = await runNpm(listTrustArguments(packageName), cwd)
	if (result.exitCode !== 0) throw npmFailure('access check', packageName, result)
	return parseTrustList(result.stdout)
}

export async function createPackageTrust(
	packageName: string,
	target: TrustTarget,
	cwd: string,
): Promise<void> {
	const result = await runNpm(createTrustArguments(packageName, target), cwd)
	if (result.exitCode !== 0) throw npmFailure('configuration', packageName, result)

	const created = parseCreatedTrust(result.stdout)
	if (created.length !== 1 || !matchesTrustTarget(created[0], target)) {
		throw new Error(`${packageName}: npm returned an unexpected trust configuration after creation.`)
	}
}

export async function revokePackageTrust(packageName: string, id: string, cwd: string): Promise<void> {
	const result = await runNpm(revokeTrustArguments(packageName, id), cwd)
	if (result.exitCode !== 0) throw npmFailure('revocation', packageName, result)
}

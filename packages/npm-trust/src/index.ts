#!/usr/bin/env bun
import { cac } from 'cac'
import pc from 'picocolors'
import { z } from 'zod'

import {
	createPackageTrust,
	ensureSupportedNpm,
	listPackageTrust,
	revokePackageTrust,
	unlockNpmTrust,
} from './npm-client'
import {
	createTrustTarget,
	detectGithubRepository,
	discoverPublishablePackages,
	matchesTrustTarget,
	planPackageTrust,
	setupOptionsSchema,
	type PublishablePackage,
	type SetupOptions,
	type TrustConfiguration,
} from './trust'

const packageVersionSchema = z.object({ version: z.string().min(1) })
const colors = pc.createColors(Boolean(process.stdout.isTTY && !process.env.NO_COLOR))

function errorMessage(error: unknown): string {
	if (error instanceof z.ZodError) {
		return error.issues
			.map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
			.join('; ')
	}
	return error instanceof Error ? error.message : String(error)
}

function isInteractive(): boolean {
	return Boolean(
		process.stdin.isTTY &&
			process.stdout.isTTY &&
			process.env.CI !== 'true' &&
			process.env.GITHUB_ACTIONS !== 'true',
	)
}

async function parseSetupOptions(raw: Record<string, unknown>): Promise<SetupOptions> {
	const cwd = typeof raw.cwd === 'string' ? raw.cwd : process.cwd()
	return setupOptionsSchema.parse({
		allowPublish: raw.allowPublish === undefined ? !raw.allowStagePublish : Boolean(raw.allowPublish),
		allowStagePublish: Boolean(raw.allowStagePublish),
		cwd,
		environment: typeof raw.env === 'string' ? raw.env || undefined : 'npm-publish',
		file: raw.file ?? 'publish.yml',
		repository: raw.repo ?? await detectGithubRepository(cwd),
	})
}

async function prepare(options: SetupOptions) {
	const discovered = await discoverPublishablePackages(options.cwd, options.repository, options.file)
	const target = createTrustTarget(options)

	console.log(`Configuring ${discovered.packages.length} packages: ${target.repository}, ${target.file}, environment=${target.environment ?? 'none'}, permissions=${target.permissions.join(',')}.`)
	await ensureSupportedNpm(discovered.rootDir)
	console.log('If npm requests 2FA, choose the five-minute skip for this batch.')
	try {
		await unlockNpmTrust(discovered.packages[0].name, discovered.rootDir)
	} catch {
		console.log('Initial npm access check failed; continuing with each package independently.')
	}

	return { ...discovered, target }
}

async function applyPackages(
	packages: PublishablePackage[],
	target: ReturnType<typeof createTrustTarget>,
	rootDir: string,
): Promise<void> {
	const outcomes = await Promise.allSettled(packages.map(async (package_) => {
		try {
			const configurations = await listPackageTrust(package_.name, rootDir)
			const plan = planPackageTrust(package_, configurations, target)
			if (plan.action === 'unchanged') {
				console.log(`  ${colors.green('unchanged')}  ${package_.name}`)
				return
			}
			if (plan.action === 'replace') {
				for (const configuration of plan.configurations) {
					await revokePackageTrust(package_.name, configuration.id, rootDir)
				}
			}
			await createPackageTrust(package_.name, target, rootDir)
			console.log(`  ${colors.green('configured')} ${package_.name}`)
		} catch (error) {
			let current: TrustConfiguration[]
			try {
				current = await listPackageTrust(package_.name, rootDir)
			} catch {
				current = []
			}
			if (current.length === 1 && matchesTrustTarget(current[0], target)) {
				console.log(`  ${colors.green('configured')} ${package_.name} (confirmed after retry)`)
				return
			}
			throw error
		}
	}))
	const completed: string[] = []
	const remaining: string[] = []
	const failures: string[] = []
	for (const [index, outcome] of outcomes.entries()) {
		const name = packages[index].name
		if (outcome.status === 'fulfilled') completed.push(name)
		else {
			remaining.push(name)
			failures.push(errorMessage(outcome.reason))
		}
	}
	if (failures.length) {
		throw new Error([
			...failures,
			`Completed: ${completed.join(', ') || 'none'}`,
			`Pending: ${remaining.join(', ')}`,
			'Rerun the same command after resolving the npm error; completed packages will be skipped.',
		].join('\n'))
	}
	console.log(`\nConfigured ${completed.length} package${completed.length === 1 ? '' : 's'}.`)
}

export async function configureGithub(raw: Record<string, unknown>): Promise<void> {
	if (!isInteractive()) {
		throw new Error('npm trust setup requires an interactive terminal and cannot run in CI.')
	}

	const options = await parseSetupOptions(raw)
	const { packages, rootDir, target } = await prepare(options)
	await applyPackages(packages, target, rootDir)
}

async function readVersion(): Promise<string> {
	const value: unknown = await Bun.file(new URL('../package.json', import.meta.url)).json()
	return packageVersionSchema.parse(value).version
}

export async function main(argv: string[] = process.argv): Promise<void> {
	const version = await readVersion()
	const cli = cac('npm-trust')
	let task: Promise<void> | undefined

	cli
		.command('[provider]', 'Configure GitHub Actions as npm trusted publishers')
		.option('--repo <owner/repository>', 'GitHub caller repository (default: origin remote)')
		.option('--file <workflow.yml>', 'Caller workflow filename (default: publish.yml)')
		.option('--env <environment>', 'GitHub environment (default: npm-publish; empty for none)')
		.option('--cwd <path>', 'Repository path (default: current directory)')
		.option('--allow-publish', 'Allow immediate publication (default unless stage-only is requested)')
		.option('--allow-stage-publish', 'Allow staged package publication')
		.example('npm-trust')
		.action((provider: string | undefined, options: Record<string, unknown>) => {
			if (provider && provider !== 'github') throw new Error('Only GitHub trusted publishers are supported.')
			task = configureGithub(options)
			return task
		})

	cli.version(version)
	cli.help()
	const parsed = cli.parse(argv)

	if (!task && !parsed.options.help && !parsed.options.version) {
		cli.outputHelp()
		process.exitCode = 1
		return
	}

	await task
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(colors.red(errorMessage(error)))
		process.exitCode = 1
	})
}

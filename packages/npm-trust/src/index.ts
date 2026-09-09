#!/usr/bin/env bun
import { cac } from 'cac'
import pc from 'picocolors'
import { createInterface } from 'node:readline/promises'
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
	discoverPublishablePackages,
	matchesTrustTarget,
	planPackageTrust,
	setupOptionsSchema,
	type PackageTrustPlan,
	type SetupOptions,
	type TrustConfiguration,
} from './trust'

const packageVersionSchema = z.object({ version: z.string().min(1) })
const colors = pc.createColors(Boolean(process.stdout.isTTY && !process.env.NO_COLOR))
const RATE_LIMIT_DELAY_MS = 2_000

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

function trustSummary(configuration: TrustConfiguration): string {
	if (configuration.type !== 'github') return `provider=${configuration.provider}`
	return [
		`repo=${configuration.repository}`,
		`file=${configuration.file}`,
		`env=${configuration.environment ?? 'none'}`,
		`permissions=${configuration.permissions.join(',')}`,
	].join(' ')
}

function printPlan(plans: PackageTrustPlan[]): void {
	console.log('\nTrust plan:')
	for (const plan of plans) {
		if (plan.action === 'create') {
			console.log(`  ${colors.yellow('create')}     ${plan.package.name}`)
			continue
		}
		if (plan.action === 'replace') {
			console.log(`  ${colors.yellow('replace')}    ${plan.package.name}`)
			for (const configuration of plan.configurations) {
				console.log(`             ${trustSummary(configuration)}`)
			}
			continue
		}

		console.log(`  ${colors.green('unchanged')}  ${plan.package.name}`)
	}
}

async function confirmApply(count: number): Promise<boolean> {
	const readline = createInterface({ input: process.stdin, output: process.stdout })
	try {
		const answer = await readline.question(`\nConfigure ${count} package${count === 1 ? '' : 's'}? [y/N] `)
		return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes'
	} finally {
		readline.close()
	}
}

function parseSetupOptions(raw: Record<string, unknown>): SetupOptions {
	return setupOptionsSchema.parse({
		allowPublish: Boolean(raw.allowPublish),
		allowStagePublish: Boolean(raw.allowStagePublish),
		apply: Boolean(raw.apply),
		cwd: typeof raw.cwd === 'string' ? raw.cwd : process.cwd(),
		environment: typeof raw.env === 'string' ? raw.env : undefined,
		file: raw.file,
		repository: raw.repo,
		yes: Boolean(raw.yes),
	})
}

async function preflight(options: SetupOptions) {
	const discovered = await discoverPublishablePackages(options.cwd, options.repository, options.file)
	const target = createTrustTarget(options)

	console.log(`Found ${discovered.packages.length} publishable package${discovered.packages.length === 1 ? '' : 's'}.`)
	console.log(`Repository: ${target.repository}`)
	console.log(`Workflow: ${target.file}`)
	console.log(`Environment: ${target.environment ?? 'none'}`)
	console.log(`Requested permissions: ${target.permissions.join(', ')}`)
	if (options.allowPublish && !options.allowStagePublish) {
		console.log('npm also grants staged publishing to new trusted publishers.')
	}

	const npmVersion = await ensureSupportedNpm(discovered.rootDir)
	console.log(`npm: ${npmVersion}`)

	console.log('\nThe next npm command may request 2FA.')
	console.log('When npm offers it, select the five-minute 2FA skip for this batch.')
	await unlockNpmTrust(discovered.packages[0].name, discovered.rootDir)
	await Bun.sleep(RATE_LIMIT_DELAY_MS)

	const plans: PackageTrustPlan[] = []
	for (let index = 0; index < discovered.packages.length; index++) {
		const package_ = discovered.packages[index]
		const configurations = await listPackageTrust(package_.name, discovered.rootDir)
		plans.push(planPackageTrust(package_, configurations, target))
		if (index < discovered.packages.length - 1) await Bun.sleep(RATE_LIMIT_DELAY_MS)
	}

	return { plans, rootDir: discovered.rootDir, target }
}

async function applyPlans(
	plans: PackageTrustPlan[],
	target: ReturnType<typeof createTrustTarget>,
	rootDir: string,
): Promise<void> {
	const pending = plans.filter((plan) => plan.action !== 'unchanged')
	const completed: string[] = []

	for (let index = 0; index < pending.length; index++) {
		const plan = pending[index]
		const package_ = plan.package
		try {
			if (plan.action === 'replace') {
				for (const configuration of plan.configurations) {
					await revokePackageTrust(package_.name, configuration.id, rootDir)
					await Bun.sleep(RATE_LIMIT_DELAY_MS)
				}
			}
			await createPackageTrust(package_.name, target, rootDir)
			completed.push(package_.name)
			console.log(`  ${colors.green('configured')} ${package_.name}`)
		} catch (error) {
			await Bun.sleep(RATE_LIMIT_DELAY_MS)
			let current: TrustConfiguration[]
			try {
				current = await listPackageTrust(package_.name, rootDir)
			} catch {
				current = []
			}
			if (current.length === 1 && matchesTrustTarget(current[0], target)) {
				completed.push(package_.name)
				console.log(`  ${colors.green('configured')} ${package_.name} (confirmed after retry)`)
				if (index < pending.length - 1) await Bun.sleep(RATE_LIMIT_DELAY_MS)
				continue
			}

			const remaining = pending.slice(index).map((plan) => plan.package.name)
			throw new Error(
				[
					errorMessage(error),
					`Completed: ${completed.join(', ') || 'none'}`,
					`Pending: ${remaining.join(', ')}`,
					'Rerun the same command after resolving the npm error; completed packages will be skipped.',
				].join('\n'),
			)
		}

		if (index < pending.length - 1) await Bun.sleep(RATE_LIMIT_DELAY_MS)
	}
}

export async function configureGithub(raw: Record<string, unknown>): Promise<void> {
	const options = parseSetupOptions(raw)

	if (!isInteractive()) {
		throw new Error('npm trust setup requires an interactive terminal and cannot run in CI.')
	}

	const { plans, rootDir, target } = await preflight(options)
	printPlan(plans)

	const changeCount = plans.filter((plan) => plan.action !== 'unchanged').length
	if (changeCount === 0) {
		console.log('\nAll packages already have the requested trust configuration.')
		return
	}

	if (!options.apply) {
		console.log(`\nPlan only. Rerun with --apply to configure ${changeCount} package${changeCount === 1 ? '' : 's'}.`)
		return
	}

	if (!options.yes && !(await confirmApply(changeCount))) {
		console.log('No changes made.')
		return
	}

	console.log('\nApplying npm trust configuration:')
	await applyPlans(plans, target, rootDir)
	console.log(`\nConfigured ${changeCount} package${changeCount === 1 ? '' : 's'}.`)
}

async function readVersion(): Promise<string> {
	const value: unknown = await Bun.file(new URL('../package.json', import.meta.url)).json()
	return packageVersionSchema.parse(value).version
}

async function main(): Promise<void> {
	const version = await readVersion()
	const cli = cac('npm-trust')
	let task: Promise<void> | undefined

	cli
		.command('github', 'Configure GitHub Actions as npm trusted publishers')
		.option('--repo <owner/repository>', 'GitHub caller repository')
		.option('--file <workflow.yml>', 'Caller workflow filename')
		.option('--env <environment>', 'Required GitHub environment')
		.option('--cwd <path>', 'Repository path (default: current directory)')
		.option('--allow-publish', 'Allow immediate package publication')
		.option('--allow-stage-publish', 'Allow staged package publication')
		.option('--apply', 'Create missing and replace differing trust configurations after preflight')
		.option('-y, --yes', 'Skip the final wrapper confirmation')
		.example(
			'npm-trust github --repo utilities-studio/lena --file publish.yml --env npm-publish --allow-publish --apply',
		)
		.action((options: Record<string, unknown>) => {
			task = configureGithub(options)
			return task
		})

	cli.version(version)
	cli.help()
	const parsed = cli.parse()

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

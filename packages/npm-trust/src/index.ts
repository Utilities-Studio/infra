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

	const results = await Promise.allSettled(discovered.packages.map(async (package_) => {
		const configurations = await listPackageTrust(package_.name, discovered.rootDir)
		return planPackageTrust(package_, configurations, target)
	}))
	const plans = results.map((result) => {
		if (result.status === 'rejected') throw result.reason
		return result.value
	})

	return { plans, rootDir: discovered.rootDir, target }
}

async function applyPlans(
	plans: PackageTrustPlan[],
	target: ReturnType<typeof createTrustTarget>,
	rootDir: string,
): Promise<void> {
	const pending = plans.filter((plan) => plan.action !== 'unchanged')
	const outcomes = await Promise.allSettled(pending.map(async (plan) => {
		const package_ = plan.package
		try {
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
		const name = pending[index].package.name
		if (outcome.status === 'fulfilled') completed.push(name)
		else {
			remaining.push(name)
			failures.push(`${name}: ${errorMessage(outcome.reason)}`)
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
		.option('-y, --yes', 'Accepted for compatibility; --apply already confirms changes')
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

#!/usr/bin/env bun
import { isCancel, select, text } from '@clack/prompts'
import { cac } from 'cac'
import Stripe from 'stripe'

import {
	banner,
	fail,
	isInteractive,
	printVersion,
	readPackageVersion,
} from './cli-kit'
import { pull } from './pull.ts'
import { push } from './push.ts'
import { webhook } from './webhook.ts'

const COMMANDS = ['push', 'pull', 'webhook'] as const
const PULL_TARGETS = ['auto', 'public', 'stripe-sync-engine'] as const
type Command = (typeof COMMANDS)[number]
type PullTarget = (typeof PULL_TARGETS)[number]

function createCli() {
	const cli = cac('stripe-sync')
	cli.command('push <config>', 'Push products/prices from config to Stripe')
		.option('--dry', 'Dry run -- show what would change')
		.option('-y, --yes', 'Skip interactive confirmations')
		.example('stripe-sync push ./scripts/stripe-config.json')
		.example('stripe-sync push ./scripts/stripe-config.json --dry')
	cli.command('pull', 'Pull products/prices from Stripe to Supabase')
		.option('--target <target>', 'Pull target: auto, public, stripe-sync-engine')
		.option('--dry', 'Dry run -- read Stripe but do not write to Supabase')
		.option('-y, --yes', 'Skip interactive confirmations')
		.example('stripe-sync pull')
		.example('stripe-sync pull --target=stripe-sync-engine')
	cli.command('webhook <config>', 'Setup/update Stripe webhook endpoint')
		.option('--dry', 'Dry run -- show what would change')
		.option('-y, --yes', 'Skip interactive confirmations')
		.example('stripe-sync webhook ./scripts/stripe-config.json')
	cli.option('-v, --version', 'Show version')
	cli.help((sections) => [
		...sections,
		{
			title: 'Environment',
			body: [
				'STRIPE_SECRET_KEY          Required for all commands',
				'SUPABASE_URL               Required for pull and webhook fallback',
				'SUPABASE_SERVICE_ROLE_KEY  Required for pull',
				'SUPABASE_DB_URL            Used by stripe-sync-engine pull target',
				'STRIPE_SYNC_TARGET         Pull target override',
				'WEBHOOK_URL                Override webhook endpoint URL',
			].join('\n'),
		},
	])
	return cli
}

function isPullTarget(value: string): value is PullTarget {
	return PULL_TARGETS.includes(value as PullTarget)
}

function printUsageAndExit(message: string): never {
	fail(message)
	createCli().outputHelp()
	process.exit(1)
}

function validateRawOptions(raw: string[]): void {
	const booleanFlags = new Set([
		'--dry',
		'--yes',
		'-y',
		'--version',
		'-v',
		'--help',
		'-h',
	])
	const valueFlags = new Set(['--target'])

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

async function promptCommand(): Promise<Command> {
	const answer = await select<Command>({
		message: 'Select a Stripe sync command',
		options: COMMANDS.map((command) => ({ label: command, value: command })),
		initialValue: 'pull',
	})
	if (isCancel(answer)) process.exit(1)
	return answer
}

async function promptConfigPath(command: Exclude<Command, 'pull'>): Promise<string> {
	const answer = await text({
		message: `Config path for ${command}`,
		placeholder: './scripts/stripe-config.json',
		validate: (value) =>
			value?.trim() ? undefined : 'Config path is required',
	})
	if (isCancel(answer)) process.exit(1)
	return String(answer).trim()
}

async function main() {
	const version = await readPackageVersion()
	const cli = createCli()
	validateRawOptions(process.argv.slice(2))
	const parsed = cli.parse(process.argv, { run: false })
	const options = parsed.options

	if (options.help || options.h) return
	if (options.version || options.v) {
		printVersion('stripe-sync', version)
		return
	}

	let command = cli.matchedCommandName as Command | undefined
	let configPath = parsed.args[0] ? String(parsed.args[0]) : null

	if (!command) {
		if (!isInteractive()) {
			printUsageAndExit('stripe-sync requires a command in non-interactive mode.')
		}
		command = await promptCommand()
		if (command !== 'pull') configPath = await promptConfigPath(command)
	}

	if (!COMMANDS.includes(command)) {
		printUsageAndExit(`Invalid command "${command}". Expected: ${COMMANDS.join(', ')}`)
	}

	if ((command === 'push' || command === 'webhook') && !configPath) {
		if (isInteractive()) {
			configPath = await promptConfigPath(command)
		} else {
			printUsageAndExit(`Config path required: stripe-sync ${command} <config.json>`)
		}
	}

	if (command === 'pull' && parsed.args.length > 0) {
		printUsageAndExit(`Unexpected argument for pull: ${String(parsed.args[0])}`)
	}

	if ((command === 'push' || command === 'webhook') && parsed.args.length > 1) {
		printUsageAndExit(`Unexpected argument: ${String(parsed.args[1])}`)
	}

	const stripeKey = process.env.STRIPE_SECRET_KEY
	if (!stripeKey) {
		fail('STRIPE_SECRET_KEY is required')
		process.exit(1)
	}

	banner('stripe-sync', version, 'Stripe config and Supabase sync')

	const stripe = new Stripe(stripeKey)
	const dryRun = Boolean(options.dry)

	if (command === 'push') {
		await push(stripe, configPath!, dryRun)
		return
	}

	if (command === 'pull') {
		const rawPullTarget =
			(typeof options.target === 'string' ? options.target : null) ??
			process.env.STRIPE_SYNC_TARGET ??
			'auto'

		if (!isPullTarget(rawPullTarget)) {
			fail(`Invalid pull target "${rawPullTarget}". Expected: ${PULL_TARGETS.join(', ')}`)
			process.exit(1)
		}

		await pull(stripe, { dryRun, target: rawPullTarget })
		return
	}

	await webhook(stripe, configPath!, dryRun)
}

if (import.meta.main) {
	main().catch((error) => {
		fail(error instanceof Error ? error.message : String(error))
		process.exit(1)
	})
}

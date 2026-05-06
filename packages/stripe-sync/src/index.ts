#!/usr/bin/env bun
import Stripe from 'stripe'

import { pull } from './pull.ts'
import { push } from './push.ts'
import { webhook } from './webhook.ts'

const COMMANDS = ['push', 'pull', 'webhook'] as const
const PULL_TARGETS = ['auto', 'public', 'stripe-sync-engine'] as const
type Command = (typeof COMMANDS)[number]
type PullTarget = (typeof PULL_TARGETS)[number]

function usage(): never {
	console.log(`Usage: stripe-sync <command> [config-path] [--dry]

Commands:
  push <config.json>      Push products/prices from config to Stripe
  pull                    Pull products/prices from Stripe to Supabase
  webhook <config.json>   Setup/update Stripe webhook endpoint

Options:
  --dry                   Dry run -- show what would change
  --target=<target>       Pull target: auto, public, stripe-sync-engine

Environment:
  STRIPE_SECRET_KEY       Required for all commands
  SUPABASE_URL            Required for pull and webhook (fallback)
  SUPABASE_SERVICE_ROLE_KEY  Required for pull
  SUPABASE_DB_URL         Used by stripe-sync-engine pull target
  STRIPE_SYNC_TARGET      Pull target override
  WEBHOOK_URL             Override webhook endpoint URL (skips Supabase URL)`)

	process.exit(1)
}

function getOption(name: string): string | undefined {
	const inline = args.find((arg) => arg.startsWith(`${name}=`))
	if (inline) return inline.slice(name.length + 1)

	const index = args.indexOf(name)
	if (index === -1) return undefined

	return args[index + 1]
}

function isPullTarget(value: string): value is PullTarget {
	return PULL_TARGETS.includes(value as PullTarget)
}

const args = process.argv.slice(2)
const command = args[0] as Command | undefined
const dryRun = args.includes('--dry')
const configPath = args.find((a) => !a.startsWith('--') && a !== command)

if (!command || !COMMANDS.includes(command)) usage()

let pullTarget: PullTarget | undefined
if (command === 'pull') {
	const rawPullTarget =
		getOption('--target') ?? process.env.STRIPE_SYNC_TARGET ?? 'auto'
	if (!isPullTarget(rawPullTarget)) {
		console.error(
			`Invalid pull target "${rawPullTarget}". Expected: ${PULL_TARGETS.join(', ')}`
		)
		process.exit(1)
	}
	pullTarget = rawPullTarget
}

const stripeKey = process.env.STRIPE_SECRET_KEY
if (!stripeKey) {
	console.error('STRIPE_SECRET_KEY is required')
	process.exit(1)
}

const stripe = new Stripe(stripeKey)

if (command === 'push') {
	if (!configPath) {
		console.error('Config path required: stripe-sync push <config.json>')
		process.exit(1)
	}
	await push(stripe, configPath, dryRun)
} else if (command === 'pull') {
	await pull(stripe, { target: pullTarget })
} else if (command === 'webhook') {
	if (!configPath) {
		console.error('Config path required: stripe-sync webhook <config.json>')
		process.exit(1)
	}
	await webhook(stripe, configPath, dryRun)
}

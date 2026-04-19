#!/usr/bin/env bun
import Stripe from 'stripe'

import { pull } from './pull.ts'
import { push } from './push.ts'
import { webhook } from './webhook.ts'

const COMMANDS = ['push', 'pull', 'webhook'] as const
type Command = (typeof COMMANDS)[number]

function usage(): never {
	console.log(`Usage: stripe-sync <command> [config-path] [--dry]

Commands:
  push <config.json>      Push products/prices from config to Stripe
  pull                    Pull products/prices from Stripe to Supabase
  webhook <config.json>   Setup/update Stripe webhook endpoint

Options:
  --dry                   Dry run -- show what would change

Environment:
  STRIPE_SECRET_KEY       Required for all commands
  SUPABASE_URL            Required for pull and webhook
  SUPABASE_SERVICE_ROLE_KEY  Required for pull`)

	process.exit(1)
}

const args = process.argv.slice(2)
const command = args[0] as Command | undefined
const dryRun = args.includes('--dry')
const configPath = args.find((a) => !a.startsWith('--') && a !== command)

if (!command || !COMMANDS.includes(command)) usage()

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
	await pull(stripe)
} else if (command === 'webhook') {
	if (!configPath) {
		console.error('Config path required: stripe-sync webhook <config.json>')
		process.exit(1)
	}
	await webhook(stripe, configPath, dryRun)
}

import type Stripe from 'stripe'

import { fail, info } from './cli-kit'
import type { StripeConfig } from './types.ts'

export async function webhook(
	stripe: Stripe,
	configPath: string,
	dryRun: boolean,
): Promise<void> {
	const config: StripeConfig = await Bun.file(configPath).json()

	const supabaseUrl =
		process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL

	// Priority: WEBHOOK_URL env > config webhookUrl > Supabase URL fallback
	const webhookUrl =
		process.env.WEBHOOK_URL ||
		config.webhookUrl ||
		(supabaseUrl ? `${supabaseUrl}/functions/v1/stripe-webhooks` : undefined)

	if (!webhookUrl) {
		fail(
			'Webhook URL required. Set WEBHOOK_URL env var, add webhookUrl to config, or set SUPABASE_URL.',
		)
		process.exit(1)
	}
	const webhookEvents = config.webhookEvents
	const webhookName = config.webhookName

	info('=== Stripe Webhook Setup ===\n')
	info(`Endpoint: ${webhookUrl}`)

	const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
	const existing = endpoints.data.find((ep) => ep.url === webhookUrl)

	if (existing) {
		const existingEvents = new Set(existing.enabled_events)
		const desiredEvents = new Set(webhookEvents as string[])
		const eventsMatch =
			existingEvents.size === desiredEvents.size &&
			[...desiredEvents].every((e) => existingEvents.has(e))

		if (
			eventsMatch &&
			existing.status === 'enabled' &&
			existing.description === webhookName
		) {
			info(`  = Webhook up to date (${existing.id})`)
			return
		}

		if (dryRun) {
			const added = [...desiredEvents].filter((e) => !existingEvents.has(e))
			const removed = [...existingEvents].filter((e) => !desiredEvents.has(e))
			if (added.length)
				info(`  + Would add events: ${added.join(', ')}`)
			if (removed.length)
				info(`  - Would remove events: ${removed.join(', ')}`)
			return
		}

		await stripe.webhookEndpoints.update(existing.id, {
			description: webhookName,
			enabled_events: webhookEvents,
		})
		info(`  ~ Updated webhook events (${existing.id})`)
		return
	}

	if (dryRun) {
		info('  + Would create webhook endpoint')
		info(`    Events: ${webhookEvents.join(', ')}`)
		return
	}

	const endpoint = await stripe.webhookEndpoints.create({
		description: webhookName,
		enabled_events: webhookEvents,
		url: webhookUrl,
	})

	info(`  + Created webhook endpoint (${endpoint.id})`)

	if (endpoint.secret) {
		info(`\n  STRIPE_WEBHOOK_SECRET=${endpoint.secret}`)
		info('  Add this to your .env file')
	}
}

import type Stripe from 'stripe'

import type { StripeConfig } from './types.ts'

export async function webhook(
	stripe: Stripe,
	configPath: string,
	dryRun: boolean,
): Promise<void> {
	const config: StripeConfig = await Bun.file(configPath).json()

	const supabaseUrl =
		process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
	if (!supabaseUrl) {
		console.error(
			'SUPABASE_URL or VITE_SUPABASE_URL required for webhook setup',
		)
		process.exit(1)
	}

	const webhookUrl = `${supabaseUrl}/functions/v1/stripe-webhooks`
	const webhookEvents = config.webhookEvents
	const webhookName = config.webhookName

	console.log('=== Stripe Webhook Setup ===\n')
	console.log(`Endpoint: ${webhookUrl}`)

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
			console.log(`  = Webhook up to date (${existing.id})`)
			return
		}

		if (dryRun) {
			const added = [...desiredEvents].filter((e) => !existingEvents.has(e))
			const removed = [...existingEvents].filter((e) => !desiredEvents.has(e))
			if (added.length)
				console.log(`  + Would add events: ${added.join(', ')}`)
			if (removed.length)
				console.log(`  - Would remove events: ${removed.join(', ')}`)
			return
		}

		await stripe.webhookEndpoints.update(existing.id, {
			description: webhookName,
			enabled_events: webhookEvents,
		})
		console.log(`  ~ Updated webhook events (${existing.id})`)
		return
	}

	if (dryRun) {
		console.log('  + Would create webhook endpoint')
		console.log(`    Events: ${webhookEvents.join(', ')}`)
		return
	}

	const endpoint = await stripe.webhookEndpoints.create({
		description: webhookName,
		enabled_events: webhookEvents,
		url: webhookUrl,
	})

	console.log(`  + Created webhook endpoint (${endpoint.id})`)

	if (endpoint.secret) {
		console.log(`\n  STRIPE_WEBHOOK_SECRET=${endpoint.secret}`)
		console.log('  Add this to your .env file')
	}
}

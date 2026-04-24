import type Stripe from 'stripe'

export type PriceConfig = {
	amount: number
	interval?: 'month' | 'year'
	lookup_key: string
	one_time?: boolean
}

export type ProductConfig = {
	description: string
	features?: string[]
	metadata?: Record<string, string>
	name: string
	prices: PriceConfig[]
}

export type StripeConfig = {
	products: Array<{
		description: string
		features?: string[]
		metadata?: Record<string, string>
		name: string
		prices: Array<{
			amount: number
			interval?: 'month' | 'year'
			lookupKey: string
			oneTime?: boolean
		}>
	}>
	webhookEvents: Stripe.WebhookEndpointCreateParams.EnabledEvent[]
	webhookName: string
	webhookUrl?: string
}

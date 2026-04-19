import type Stripe from 'stripe'

export type PriceConfig = {
	amount: number
	interval: 'month' | 'year'
	lookup_key: string
	one_time?: boolean
}

export type ProductConfig = {
	description: string
	features: string[]
	metadata: Record<string, string>
	name: string
	prices: PriceConfig[]
}

export type StripeConfig = {
	creditPackProducts: Array<{
		description: string
		metadata: Record<string, string>
		name: string
		prices: Array<{
			amount: number
			interval: 'month' | 'year'
			lookupKey: string
		}>
	}>
	subscriptionProducts: Array<{
		description: string
		displayOrder: number
		features: string[]
		highlighted: boolean
		metadata: Record<string, string>
		name: string
		prices: Array<{
			amount: number
			interval: 'month' | 'year'
			lookupKey: string
		}>
	}>
	webhookEvents: Stripe.WebhookEndpointCreateParams.EnabledEvent[]
	webhookName: string
}

import type Stripe from 'stripe'

import type { ProductConfig, StripeConfig } from './types.ts'

function formatAmount(amount: number): string {
	const dollars = amount / 100
	return `$${dollars % 1 === 0 ? dollars : dollars.toFixed(2)}`
}

function buildMarketingFeatures(
	product: ProductConfig,
): Stripe.ProductCreateParams.MarketingFeature[] {
	return (product.features ?? []).map((name) => ({ name }))
}

function metadataChanged(
	existing: Stripe.Metadata,
	desired: Record<string, string>,
): boolean {
	const allKeys = new Set([...Object.keys(existing), ...Object.keys(desired)])
	for (const key of allKeys) {
		if (existing[key] !== desired[key]) return true
	}
	return false
}

async function syncPrices(
	stripe: Stripe,
	productId: string,
	productConfig: ProductConfig,
	dryRun: boolean,
): Promise<void> {
	if (productConfig.prices.length === 0) return

	const existingPrices = await stripe.prices.list({
		active: true,
		limit: 100,
		product: productId,
	})

	for (const priceConfig of productConfig.prices) {
		const existing = existingPrices.data.find(
			(p) => p.lookup_key === priceConfig.lookup_key,
		)

		const priceLabel = priceConfig.one_time
			? formatAmount(priceConfig.amount)
			: `${formatAmount(priceConfig.amount)}/${priceConfig.interval}`

		const createParams: Stripe.PriceCreateParams = priceConfig.one_time
			? {
					currency: 'usd',
					lookup_key: priceConfig.lookup_key,
					product: productId,
					transfer_lookup_key: true,
					unit_amount: priceConfig.amount,
				}
			: {
					currency: 'usd',
					lookup_key: priceConfig.lookup_key,
					product: productId,
					recurring: { interval: priceConfig.interval! },
					transfer_lookup_key: true,
					unit_amount: priceConfig.amount,
				}

		if (existing) {
			const amountMatch = existing.unit_amount === priceConfig.amount
			const shapeMatch = priceConfig.one_time
				? existing.recurring === null
				: existing.recurring?.interval === priceConfig.interval

			if (amountMatch && shapeMatch) continue

			if (dryRun) {
				console.log(
					`    ~ Would update price: ${priceLabel} [${priceConfig.lookup_key}]`,
				)
				continue
			}

			await stripe.prices.create(createParams)
			console.log(
				`    ~ Updated price: ${priceLabel} [${priceConfig.lookup_key}]`,
			)
		} else {
			if (dryRun) {
				console.log(
					`    + Would create price: ${priceLabel} [${priceConfig.lookup_key}]`,
				)
				continue
			}

			await stripe.prices.create(createParams)
			console.log(
				`    + Created price: ${priceLabel} [${priceConfig.lookup_key}]`,
			)
		}
	}
}

async function syncProduct(
	stripe: Stripe,
	productConfig: ProductConfig,
	existingProducts: Stripe.Product[],
	dryRun: boolean,
): Promise<void> {
	const existing = existingProducts.find((p) => p.name === productConfig.name)
	const metadata = productConfig.metadata ?? {}
	const marketingFeatures = buildMarketingFeatures(productConfig)

	if (existing) {
		const fullMetadata: Record<string, string> = {}
		for (const key of Object.keys(existing.metadata)) {
			if (!(key in metadata)) {
				fullMetadata[key] = ''
			}
		}
		Object.assign(fullMetadata, metadata)

		const needsUpdate =
			metadataChanged(existing.metadata, metadata) ||
			existing.description !== productConfig.description ||
			JSON.stringify(existing.marketing_features) !==
				JSON.stringify(marketingFeatures)

		if (needsUpdate) {
			if (dryRun) {
				const staleKeys = Object.entries(fullMetadata)
					.filter(([, v]) => v === '')
					.map(([k]) => k)
				console.log(`  ~ Would update: ${productConfig.name}`)
				if (staleKeys.length)
					console.log(`    - Would remove metadata: ${staleKeys.join(', ')}`)
			} else {
				await stripe.products.update(existing.id, {
					description: productConfig.description,
					marketing_features: marketingFeatures,
					metadata: fullMetadata,
				})
				console.log(`  ~ Updated: ${productConfig.name}`)
			}
		} else {
			console.log(`  = Up to date: ${productConfig.name}`)
		}

		await syncPrices(stripe, existing.id, productConfig, dryRun)
		return
	}

	if (dryRun) {
		console.log(`  + Would create: ${productConfig.name}`)
		for (const price of productConfig.prices) {
			const label = price.one_time
				? formatAmount(price.amount)
				: `${formatAmount(price.amount)}/${price.interval}`
			console.log(`    + Would create price: ${label} [${price.lookup_key}]`)
		}
		return
	}

	const product = await stripe.products.create({
		description: productConfig.description,
		marketing_features: marketingFeatures,
		metadata,
		name: productConfig.name,
	})

	for (const price of productConfig.prices) {
		const params: Stripe.PriceCreateParams = price.one_time
			? {
					currency: 'usd',
					lookup_key: price.lookup_key,
					product: product.id,
					transfer_lookup_key: true,
					unit_amount: price.amount,
				}
			: {
					currency: 'usd',
					lookup_key: price.lookup_key,
					product: product.id,
					recurring: { interval: price.interval! },
					transfer_lookup_key: true,
					unit_amount: price.amount,
				}
		await stripe.prices.create(params)
	}

	const priceStr = productConfig.prices
		.map((p) =>
			p.one_time
				? formatAmount(p.amount)
				: `${formatAmount(p.amount)}/${p.interval}`,
		)
		.join(', ')
	console.log(`  + Created: ${productConfig.name} (${priceStr || 'free'})`)
}

function parseConfig(config: StripeConfig): ProductConfig[] {
	return config.products.map((p) => ({
		description: p.description,
		features: p.features,
		metadata: p.metadata,
		name: p.name,
		prices: p.prices.map((pr) => ({
			amount: pr.amount,
			interval: pr.interval,
			lookup_key: pr.lookupKey,
			one_time: pr.oneTime,
		})),
	}))
}

export async function push(
	stripe: Stripe,
	configPath: string,
	dryRun: boolean,
): Promise<void> {
	const config: StripeConfig = await Bun.file(configPath).json()
	const products = parseConfig(config)

	if (dryRun) console.log('DRY RUN -- no changes will be made\n')

	console.log('=== Stripe Push ===\n')

	const allProducts = await stripe.products.list({ limit: 100 })
	const existingProducts = allProducts.data

	for (const product of products) {
		await syncProduct(stripe, product, existingProducts, dryRun)
	}

	console.log('\nDone!')
}

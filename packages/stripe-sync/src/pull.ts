import type Stripe from 'stripe'

function getErrorMessage(err: unknown): string {
	if (err instanceof Error) return err.message
	return String(err)
}

async function supabaseUpsert(
	table: string,
	row: Record<string, unknown>,
): Promise<void> {
	const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
	const key =
		process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY

	if (!url || !key) {
		throw new Error(
			'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for pull',
		)
	}

	const res = await fetch(`${url}/rest/v1/${table}?on_conflict=id`, {
		body: JSON.stringify(row),
		headers: {
			apikey: key,
			Authorization: `Bearer ${key}`,
			'Content-Type': 'application/json',
			Prefer: 'resolution=merge-duplicates',
		},
		method: 'POST',
	})

	if (!res.ok) {
		const body = await res.text()
		throw new Error(`${res.status}: ${body}`)
	}
}

async function pullProducts(stripe: Stripe): Promise<{
	errors: number
	synced: number
}> {
	console.log('\nSyncing products (active only)...')

	let hasMore = true
	let startingAfter: string | undefined
	let synced = 0
	let errors = 0

	while (hasMore) {
		const products = await stripe.products.list({
			active: true,
			limit: 100,
			starting_after: startingAfter,
		})

		for (const product of products.data) {
			try {
				const marketingFeatures = (product.marketing_features ?? [])
					.map((f) => f.name)
					.filter((name): name is string => name !== undefined)

				await supabaseUpsert('stripe_products', {
					active: product.active,
					description: product.description,
					id: product.id,
					marketing_features: marketingFeatures,
					metadata: product.metadata ?? {},
					name: product.name,
					updated_at: new Date().toISOString(),
				})

				console.log(`  ok ${product.id} - ${product.name}`)
				synced++
			} catch (err) {
				console.error(`  FAIL ${product.id}: ${getErrorMessage(err)}`)
				errors++
			}
		}

		hasMore = products.has_more
		if (products.data.length > 0) {
			startingAfter = products.data[products.data.length - 1].id
		}
	}

	return { errors, synced }
}

async function pullPrices(stripe: Stripe): Promise<{
	errors: number
	skipped: number
	synced: number
}> {
	console.log('\nSyncing prices (active only)...')

	let hasMore = true
	let startingAfter: string | undefined
	let synced = 0
	let errors = 0
	let skipped = 0

	while (hasMore) {
		const prices = await stripe.prices.list({
			active: true,
			limit: 100,
			starting_after: startingAfter,
		})

		for (const price of prices.data) {
			try {
				if (!price.lookup_key) {
					skipped++
					continue
				}

				const productId =
					typeof price.product === 'string' ? price.product : price.product.id

				await supabaseUpsert('stripe_prices', {
					active: price.active,
					currency: price.currency,
					id: price.id,
					lookup_key: price.lookup_key,
					metadata: price.metadata,
					nickname: price.nickname,
					product_id: productId,
					recurring_interval: price.recurring?.interval ?? null,
					recurring_interval_count: price.recurring?.interval_count ?? null,
					type: price.type,
					unit_amount: price.unit_amount,
					updated_at: new Date().toISOString(),
				})

				console.log(
					`  ok ${price.id} - ${price.nickname ?? price.lookup_key}`,
				)
				synced++
			} catch (err) {
				console.error(`  FAIL ${price.id}: ${getErrorMessage(err)}`)
				errors++
			}
		}

		hasMore = prices.has_more
		if (prices.data.length > 0) {
			startingAfter = prices.data[prices.data.length - 1].id
		}
	}

	return { errors, skipped, synced }
}

export async function pull(stripe: Stripe): Promise<void> {
	console.log('=== Stripe Pull ===')

	const productResult = await pullProducts(stripe)
	const priceResult = await pullPrices(stripe)

	console.log('\n--- Summary ---')
	console.log(
		`  products: ${productResult.synced} synced, ${productResult.errors} errors`,
	)
	const skippedStr =
		priceResult.skipped > 0 ? ` (${priceResult.skipped} skipped)` : ''
	console.log(
		`  prices: ${priceResult.synced} synced, ${priceResult.errors} errors${skippedStr}`,
	)

	const totalErrors = productResult.errors + priceResult.errors
	if (totalErrors > 0) process.exit(1)
}

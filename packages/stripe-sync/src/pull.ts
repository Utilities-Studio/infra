import type Stripe from 'stripe'
import { StripeSync, runMigrations } from '@supabase/stripe-sync-engine'

type PullOptions = {
	target?: PullTarget
}

type PullTarget = 'auto' | 'public' | 'stripe-sync-engine'
type ResolvedPullTarget = Exclude<PullTarget, 'auto'>

type SupabaseConfig = {
	databaseUrl?: string
	key: string
	target: ResolvedPullTarget
	url: string
}

type SupabaseTable = {
	name: string
	schema?: string
}

type ProductPullResult = {
	errors: number
	synced: number
}

type PricePullResult = {
	errors: number
	skipped: number
	synced: number
}

const TARGET_TABLES: Record<
	ResolvedPullTarget,
	{
		prices: SupabaseTable
		products: SupabaseTable
	}
> = {
	public: {
		prices: { name: 'stripe_prices' },
		products: { name: 'stripe_products' }
	},
	'stripe-sync-engine': {
		prices: { name: 'prices', schema: 'stripe' },
		products: { name: 'products', schema: 'stripe' }
	}
}

function getErrorMessage(err: unknown): string {
	if (err instanceof Error) return err.message
	return String(err)
}

function getObjectId(value: null | string | { id: string } | undefined) {
	if (!value) return null
	return typeof value === 'string' ? value : value.id
}

function getSupabaseCredentials(): Omit<SupabaseConfig, 'target'> {
	const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
	const key =
		process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY

	if (!url || !key) {
		throw new Error(
			'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for pull'
		)
	}

	return {
		databaseUrl: process.env.SUPABASE_DB_URL,
		key,
		url: url.replace(/\/$/, '')
	}
}

function getSupabaseHeaders(config: SupabaseConfig, table: SupabaseTable) {
	const headers: Record<string, string> = {
		apikey: config.key,
		Authorization: `Bearer ${config.key}`,
		'Content-Type': 'application/json'
	}

	if (table.schema) {
		headers['Accept-Profile'] = table.schema
		headers['Content-Profile'] = table.schema
	}

	return headers
}

function getSupabaseRestUrl(
	config: Pick<SupabaseConfig, 'url'>,
	table: SupabaseTable,
	query: string
) {
	return `${config.url}/rest/v1/${table.name}?${query}`
}

async function supabaseTableExists(
	config: SupabaseConfig,
	table: SupabaseTable
): Promise<boolean> {
	const res = await fetch(
		getSupabaseRestUrl(config, table, 'select=id&limit=1'),
		{
			headers: getSupabaseHeaders(config, table),
			method: 'GET'
		}
	)

	if (res.ok) return true

	if (res.status === 401 || res.status === 403) {
		throw new Error(`Supabase authentication failed (${res.status})`)
	}

	return false
}

async function targetExists(
	config: SupabaseConfig,
	target: ResolvedPullTarget
): Promise<boolean> {
	const tables = TARGET_TABLES[target]
	return (
		(await supabaseTableExists(config, tables.products)) &&
		(await supabaseTableExists(config, tables.prices))
	)
}

async function resolveSupabaseConfig(
	target: PullTarget
): Promise<SupabaseConfig> {
	const credentials = getSupabaseCredentials()
	const config = { ...credentials, target: 'public' as ResolvedPullTarget }

	if (target !== 'auto') {
		return { ...config, target }
	}

	if (await targetExists(config, 'public')) {
		return config
	}

	const stripeSchemaConfig = {
		...config,
		target: 'stripe-sync-engine' as ResolvedPullTarget
	}
	if (await targetExists(stripeSchemaConfig, 'stripe-sync-engine')) {
		return stripeSchemaConfig
	}

	throw new Error(
		'Could not find supported Supabase tables for pull. Expected either public.stripe_products/public.stripe_prices or stripe.products/stripe.prices exposed through the Supabase API.'
	)
}

function getTargetLabel(target: ResolvedPullTarget) {
	if (target === 'public') return 'public.stripe_products/public.stripe_prices'
	return 'stripe.products/stripe.prices'
}

async function supabaseUpsert(
	config: SupabaseConfig,
	table: SupabaseTable,
	row: Record<string, unknown>
): Promise<void> {
	const res = await fetch(getSupabaseRestUrl(config, table, 'on_conflict=id'), {
		body: JSON.stringify(row),
		headers: {
			...getSupabaseHeaders(config, table),
			Prefer: 'resolution=merge-duplicates'
		},
		method: 'POST'
	})

	if (!res.ok) {
		const body = await res.text()
		throw new Error(`${res.status}: ${body}`)
	}
}

async function pullStripeSyncEngineWithDatabase(config: SupabaseConfig) {
	if (!config.databaseUrl) {
		throw new Error('SUPABASE_DB_URL is required for stripe-sync-engine pull')
	}

	const stripeSecretKey = process.env.STRIPE_SECRET_KEY
	if (!stripeSecretKey) {
		throw new Error('STRIPE_SECRET_KEY is required for stripe-sync-engine pull')
	}

	console.log('\nRunning stripe-sync-engine migrations...')
	await runMigrations({
		databaseUrl: config.databaseUrl,
		logger: console,
		schema: 'stripe'
	})

	const stripeSync = new StripeSync({
		backfillRelatedEntities: true,
		poolConfig: { connectionString: config.databaseUrl, max: 5 },
		schema: 'stripe',
		stripeSecretKey,
		stripeWebhookSecret:
			process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_local_backfill_not_used'
	})

	try {
		console.log('\nSyncing products...')
		const productResult = await stripeSync.syncProducts()
		console.log(`  ok ${productResult.synced} products synced`)

		console.log('\nSyncing prices...')
		const priceResult = await stripeSync.syncPrices({
			backfillRelatedEntities: true
		})
		console.log(`  ok ${priceResult.synced} prices synced`)

		return {
			priceResult: {
				errors: 0,
				skipped: 0,
				synced: priceResult.synced
			},
			productResult: {
				errors: 0,
				synced: productResult.synced
			}
		}
	} finally {
		await stripeSync.postgresClient.close()
	}
}

function mapProductForPublic(product: Stripe.Product) {
	const marketingFeatures = (product.marketing_features ?? [])
		.map((f) => f.name)
		.filter((name): name is string => name !== undefined)

	return {
		active: product.active,
		description: product.description,
		id: product.id,
		marketing_features: marketingFeatures,
		metadata: product.metadata ?? {},
		name: product.name,
		updated_at: new Date().toISOString()
	}
}

function mapProductForStripeSyncEngine(product: Stripe.Product) {
	const syncedAt = new Date().toISOString()

	return {
		active: product.active,
		created: product.created,
		default_price: getObjectId(product.default_price),
		description: product.description,
		id: product.id,
		images: product.images ?? [],
		last_synced_at: syncedAt,
		livemode: product.livemode,
		marketing_features: product.marketing_features ?? [],
		metadata: product.metadata ?? {},
		name: product.name,
		object: product.object,
		package_dimensions: product.package_dimensions,
		shippable: product.shippable,
		statement_descriptor: product.statement_descriptor,
		unit_label: product.unit_label,
		updated: product.updated,
		url: product.url
	}
}

function mapProduct(product: Stripe.Product, target: ResolvedPullTarget) {
	if (target === 'public') return mapProductForPublic(product)
	return mapProductForStripeSyncEngine(product)
}

async function pullProducts(
	stripe: Stripe,
	config: SupabaseConfig
): Promise<ProductPullResult> {
	console.log('\nSyncing products (active only)...')

	let hasMore = true
	let startingAfter: string | undefined
	let synced = 0
	let errors = 0

	while (hasMore) {
		const products = await stripe.products.list({
			active: true,
			limit: 100,
			starting_after: startingAfter
		})

		for (const product of products.data) {
			try {
				await supabaseUpsert(
					config,
					TARGET_TABLES[config.target].products,
					mapProduct(product, config.target)
				)

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

function mapPriceForPublic(price: Stripe.Price, productId: string) {
	return {
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
		updated_at: new Date().toISOString()
	}
}

function mapPriceForStripeSyncEngine(price: Stripe.Price, productId: string) {
	return {
		active: price.active,
		billing_scheme: price.billing_scheme,
		created: price.created,
		currency: price.currency,
		id: price.id,
		last_synced_at: new Date().toISOString(),
		livemode: price.livemode,
		lookup_key: price.lookup_key,
		metadata: price.metadata ?? {},
		nickname: price.nickname,
		object: price.object,
		product: productId,
		recurring: price.recurring,
		tiers_mode: price.tiers_mode,
		transform_quantity: price.transform_quantity,
		type: price.type,
		unit_amount: price.unit_amount,
		unit_amount_decimal: price.unit_amount_decimal
	}
}

function mapPrice(
	price: Stripe.Price,
	productId: string,
	target: ResolvedPullTarget
) {
	if (target === 'public') return mapPriceForPublic(price, productId)
	return mapPriceForStripeSyncEngine(price, productId)
}

async function pullPrices(
	stripe: Stripe,
	config: SupabaseConfig
): Promise<PricePullResult> {
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
			starting_after: startingAfter
		})

		for (const price of prices.data) {
			try {
				if (config.target === 'public' && !price.lookup_key) {
					skipped++
					continue
				}

				const productId = getObjectId(price.product)
				if (!productId) {
					skipped++
					continue
				}

				await supabaseUpsert(
					config,
					TARGET_TABLES[config.target].prices,
					mapPrice(price, productId, config.target)
				)

				console.log(`  ok ${price.id} - ${price.nickname ?? price.lookup_key}`)
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

export async function pull(
	stripe: Stripe,
	options: PullOptions = {}
): Promise<void> {
	console.log('=== Stripe Pull ===')

	const config = await resolveSupabaseConfig(options.target ?? 'auto')
	console.log(`Target: ${getTargetLabel(config.target)}`)

	let priceResult: PricePullResult
	let productResult: ProductPullResult
	if (config.target === 'stripe-sync-engine' && config.databaseUrl) {
		const syncResult = await pullStripeSyncEngineWithDatabase(config)
		priceResult = syncResult.priceResult
		productResult = syncResult.productResult
	} else {
		productResult = await pullProducts(stripe, config)
		priceResult = await pullPrices(stripe, config)
	}

	console.log('\n--- Summary ---')
	console.log(
		`  products: ${productResult.synced} synced, ${productResult.errors} errors`
	)
	const skippedStr =
		priceResult.skipped > 0 ? ` (${priceResult.skipped} skipped)` : ''
	console.log(
		`  prices: ${priceResult.synced} synced, ${priceResult.errors} errors${skippedStr}`
	)

	const totalErrors = productResult.errors + priceResult.errors
	if (totalErrors > 0) process.exit(1)
}

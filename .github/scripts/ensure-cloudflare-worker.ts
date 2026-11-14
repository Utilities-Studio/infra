#!/usr/bin/env bun

/**
 * Makes sure the Worker exists before a deploy or preview upload, creating an
 * empty placeholder only when Cloudflare says, more than once and through two
 * endpoints, that it does not. Creating a Worker this way makes the placeholder
 * live at once, so a false "not found" would replace the running app; this
 * script never creates on production and never on a guess.
 */

const NOT_FOUND_CODE = 10007
const CONFIRM_ATTEMPTS = 3
const CONFIRM_DELAY_MS = 2000

const wrangler = JSON.parse(
	(await Bun.file('wrangler.jsonc').text())
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '')
)
const env = process.env.CLOUDFLARE_ENV
const name = (env && wrangler.env?.[env]?.name) || wrangler.name
const account = process.env.CLOUDFLARE_ACCOUNT_ID || wrangler.account_id
const token = process.env.CLOUDFLARE_API_TOKEN
if (!name || !account || !token) {
	throw new Error('Need worker name, account id, and CLOUDFLARE_API_TOKEN')
}

const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers`
const scriptUrl = `${base}/scripts/${encodeURIComponent(name)}/settings`
const headers = { Authorization: `Bearer ${token}` }

type Presence = 'exists' | 'missing'

/** One look at the Worker itself: only Cloudflare's own "does not exist" code counts as missing. */
async function lookUp(): Promise<Presence> {
	const response = await fetch(scriptUrl, { headers })
	if (response.ok) return 'exists'
	const text = await response.text()
	if (response.status === 404 && hasErrorCode(text, NOT_FOUND_CODE)) {
		return 'missing'
	}
	throw new Error(`GET ${name} failed: ${response.status} ${text}`)
}

/** A second, independent look: the account's Worker list. */
async function listed(): Promise<boolean> {
	const response = await fetch(`${base}/scripts`, { headers })
	const text = await response.text()
	if (!response.ok) {
		throw new Error(`List workers failed: ${response.status} ${text}`)
	}
	const body: { result?: { id?: string }[] } = JSON.parse(text)
	return (body.result ?? []).some((script) => script.id === name)
}

function hasErrorCode(text: string, code: number) {
	try {
		const body: { errors?: { code?: number }[] } = JSON.parse(text)
		return (body.errors ?? []).some((error) => error.code === code)
	} catch {
		return false
	}
}

async function confirmedMissing() {
	for (let attempt = 1; attempt <= CONFIRM_ATTEMPTS; attempt += 1) {
		if ((await lookUp()) === 'exists' || (await listed())) return false
		if (attempt < CONFIRM_ATTEMPTS) await Bun.sleep(CONFIRM_DELAY_MS)
	}
	return true
}

if (!(await confirmedMissing())) {
	console.log(`Worker ${name} exists`)
	process.exit(0)
}

if (env === 'production') {
	throw new Error(
		`Worker ${name} reads as missing on production. Not creating a placeholder over what may be the live app; check the account and deploy by hand.`
	)
}

const body = new FormData()
body.set(
	'metadata',
	JSON.stringify({
		main_module: 'index.js',
		compatibility_date:
			wrangler.compatibility_date || new Date().toISOString().slice(0, 10)
	})
)
body.set(
	'index.js',
	new File(
		["export default { fetch() { return new Response('ok') } }\n"],
		'index.js',
		{ type: 'application/javascript+module' }
	)
)
const put = await fetch(`${base}/scripts/${encodeURIComponent(name)}`, {
	body,
	headers,
	method: 'PUT'
})
if (!put.ok) {
	throw new Error(`Create ${name} failed: ${put.status} ${await put.text()}`)
}
console.log(`Created worker ${name}`)

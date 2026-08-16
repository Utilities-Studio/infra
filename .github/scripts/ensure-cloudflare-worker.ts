#!/usr/bin/env bun

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

const url = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${encodeURIComponent(name)}`
const headers = { Authorization: `Bearer ${token}` }
const get = await fetch(url, { headers })
if (get.status === 200) {
	console.log(`Worker ${name} exists`)
	process.exit(0)
}
if (get.status !== 404) {
	throw new Error(`GET ${name} failed: ${get.status} ${await get.text()}`)
}

const body = new FormData()
body.set(
	'metadata',
	JSON.stringify({
		main_module: 'index.js',
		compatibility_date: wrangler.compatibility_date || new Date().toISOString().slice(0, 10)
	})
)
body.set(
	'index.js',
	new File(["export default { fetch() { return new Response('ok') } }\n"], 'index.js', {
		type: 'application/javascript+module'
	})
)
const put = await fetch(url, { method: 'PUT', headers, body })
if (!put.ok) throw new Error(`Create ${name} failed: ${put.status} ${await put.text()}`)
console.log(`Created worker ${name}`)

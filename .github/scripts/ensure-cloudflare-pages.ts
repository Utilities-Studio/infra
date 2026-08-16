#!/usr/bin/env bun

const account = process.env.CLOUDFLARE_ACCOUNT_ID
const name = process.env.PROJECT_NAME
const token = process.env.CLOUDFLARE_API_TOKEN
if (!account || !name || !token) {
	throw new Error('Need CLOUDFLARE_ACCOUNT_ID, PROJECT_NAME, and CLOUDFLARE_API_TOKEN')
}

const headers = { Authorization: `Bearer ${token}` }
const get = await fetch(
	`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${encodeURIComponent(name)}`,
	{ headers }
)
if (get.status === 200) {
	console.log(`Pages ${name} exists`)
	process.exit(0)
}
if (get.status !== 404) {
	throw new Error(`GET ${name} failed: ${get.status} ${await get.text()}`)
}

const create = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects`, {
	body: JSON.stringify({ name, production_branch: 'main' }),
	headers: { ...headers, 'Content-Type': 'application/json' },
	method: 'POST'
})
if (!create.ok) throw new Error(`Create ${name} failed: ${create.status} ${await create.text()}`)
console.log(`Created pages ${name}`)

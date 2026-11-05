import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import {
	filterWranglerConfigs,
	parseCsvOption,
	requiredSecretKeys,
	selectCloudflareSecrets,
	selectCloudflareVars,
	supabaseProjectArgs,
} from './index'

describe('supabaseProjectArgs', () => {
	test('targets the project with --remote on Supabase CLI v3 and later', () => {
		expect(supabaseProjectArgs('3.0.0', 'abcdefghijklmnopqrst')).toEqual(['--remote=abcdefghijklmnopqrst'])
		expect(supabaseProjectArgs('v4.1.2\n', 'ref')).toEqual(['--remote=ref'])
	})

	test('keeps --project-ref on Supabase CLI v2, which has no --remote', () => {
		expect(supabaseProjectArgs('2.121.0', 'ref')).toEqual(['--project-ref', 'ref'])
	})

	test('falls back to --project-ref when the version cannot be read', () => {
		expect(supabaseProjectArgs('', 'ref')).toEqual(['--project-ref', 'ref'])
	})
})

describe('sync-env option helpers', () => {
	test('parses comma-separated key lists', () => {
		expect(parseCsvOption('API_KEY, TOKEN,, PASSWORD ')).toEqual([
			'API_KEY',
			'TOKEN',
			'PASSWORD',
		])
	})

	test('filters wrangler configs by app directory substring', () => {
		const rootDir = '/repo'
		const configs = [
			join(rootDir, 'apps/admin/wrangler.jsonc'),
			join(rootDir, 'apps/site/wrangler.jsonc'),
			join(rootDir, 'packages/worker/wrangler.jsonc'),
		]

		expect(filterWranglerConfigs(configs, rootDir, 'site')).toEqual([
			join(rootDir, 'apps/site/wrangler.jsonc'),
		])
	})

	test('uploads keys in the environment secrets.required as secrets, never as vars', () => {
		const wrangler = { env: { development: { secrets: { required: ['APP_URL', 'COMPOSIO_API_KEY'] } } } }
		const values = { APP_URL: 'https://app.example', COMPOSIO_API_KEY: 'key', LOG_LEVEL: 'debug' }
		const required = requiredSecretKeys(wrangler, 'development')

		expect(selectCloudflareVars(values, new Set(), required)).toEqual({ LOG_LEVEL: 'debug' })
		expect(selectCloudflareSecrets(values, new Set(), required)).toEqual({
			APP_URL: 'https://app.example',
			COMPOSIO_API_KEY: 'key',
		})
		expect(requiredSecretKeys(wrangler, 'production')).toEqual(new Set())
	})
})

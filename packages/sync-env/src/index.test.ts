import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { filterWranglerConfigs, parseCsvOption } from './index'

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
})

import { describe, expect, test } from 'bun:test'

import { envKeysForPrefix, renderViteEnvDeclaration } from './index'

describe('vite env helpers', () => {
	test('filters env keys by custom prefix in sorted order', () => {
		expect(
			envKeysForPrefix(
				{
					PUBLIC_API_URL: 'https://example.com',
					VITE_SITE_URL: 'https://vite.example.com',
					PUBLIC_SITE_NAME: 'Site',
				},
				'PUBLIC_',
			),
		).toEqual(['PUBLIC_API_URL', 'PUBLIC_SITE_NAME'])
	})

	test('renders import meta declarations for discovered keys', () => {
		const content = renderViteEnvDeclaration(['VITE_API_URL'])

		expect(content).toContain('readonly VITE_API_URL: string')
		expect(content).toContain('interface ImportMetaEnv')
	})
})

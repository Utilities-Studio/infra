import { afterEach, describe, expect, test } from 'bun:test'

import { diffEnv, parseEnv, parseEnvFileList } from './index'

const TEST_KEY = 'TEST_SECRET_VALUE'
const ORIGINAL_TEST_VALUE = process.env[TEST_KEY]
const ENCRYPTED_VALUE = 'old-value-x7q2p9'
const PLAINTEXT_VALUE = 'new-value-k4m8r1'

describe('env file comparison', () => {
	afterEach(() => {
		if (ORIGINAL_TEST_VALUE === undefined) {
			delete process.env[TEST_KEY]
			return
		}

		process.env[TEST_KEY] = ORIGINAL_TEST_VALUE
	})

	test('does not let process.env mask drift between decrypted and plaintext values', () => {
		process.env[TEST_KEY] = PLAINTEXT_VALUE

		const encrypted = parseEnv(`${TEST_KEY}=${ENCRYPTED_VALUE}\n`)
		const plaintext = parseEnv(`${TEST_KEY}=${PLAINTEXT_VALUE}\n`)

		expect(encrypted[TEST_KEY]).toBe(ENCRYPTED_VALUE)
		expect(plaintext[TEST_KEY]).toBe(PLAINTEXT_VALUE)
		expect(diffEnv(encrypted, plaintext)).toEqual([
			{ key: TEST_KEY, kind: 'changed' },
		])
	})
})

describe('env file option parsing', () => {
	test('splits comma-separated env file names and trims empty entries', () => {
		expect(parseEnvFileList('.env,.env.preview, .env.production ,,')).toEqual([
			'.env',
			'.env.preview',
			'.env.production',
		])
	})
})

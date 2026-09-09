import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
	createPackageTrust,
	ensureSupportedNpm,
	listPackageTrust,
} from './npm-client'
import type { TrustTarget } from './trust'

const ORIGINAL_PATH = process.env.PATH
const TARGET: TrustTarget = {
	type: 'github',
	repository: 'utilities-studio/lena',
	file: 'publish.yml',
	environment: 'npm-publish',
	permissions: ['createPackage'],
}

let fakeDirectory = ''

function trustJson(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		type: 'github',
		id: 'trust-1',
		repository: TARGET.repository,
		file: TARGET.file,
		environment: TARGET.environment,
		permissions: TARGET.permissions,
		...overrides,
	})
}

beforeEach(async () => {
	fakeDirectory = await mkdtemp(join(tmpdir(), 'npm-trust-client-test-'))
	const executable = join(fakeDirectory, 'npm')
	await Bun.write(
		executable,
		`#!/usr/bin/env bun
const args = process.argv.slice(2)
if (args[0] === '--version') {
  console.log(process.env.FAKE_NPM_VERSION ?? '12.0.2')
  process.exit(0)
}
const isCreate = args[0] === 'trust' && args[1] === 'github'
const exitCode = Number(process.env.FAKE_NPM_EXIT_CODE ?? '0')
if (exitCode !== 0) {
  console.error(process.env.FAKE_NPM_STDERR ?? 'npm failed')
  process.exit(exitCode)
}
const output = isCreate ? process.env.FAKE_NPM_CREATE_JSON : process.env.FAKE_NPM_LIST_JSON
if (output) console.log(output)
`,
	)
	await chmod(executable, 0o755)
	process.env.PATH = `${fakeDirectory}:${ORIGINAL_PATH ?? ''}`
})

afterEach(async () => {
	process.env.PATH = ORIGINAL_PATH
	delete process.env.FAKE_NPM_VERSION
	delete process.env.FAKE_NPM_EXIT_CODE
	delete process.env.FAKE_NPM_STDERR
	delete process.env.FAKE_NPM_LIST_JSON
	delete process.env.FAKE_NPM_CREATE_JSON
	await rm(fakeDirectory, { force: true, recursive: true })
})

describe.serial('npm client boundary', () => {
	test('checks the actual npm executable version', async () => {
		process.env.FAKE_NPM_VERSION = '11.15.0'
		expect(await ensureSupportedNpm(process.cwd())).toBe('11.15.0')

		process.env.FAKE_NPM_VERSION = '13.0.0'
		await expect(ensureSupportedNpm(process.cwd())).rejects.toThrow('unsupported')
	})

	test('parses list output and validates create output before success', async () => {
		process.env.FAKE_NPM_LIST_JSON = trustJson()
		expect(await listPackageTrust('@lena-inc/core', process.cwd())).toHaveLength(1)

		process.env.FAKE_NPM_CREATE_JSON = trustJson()
		await expect(createPackageTrust('@lena-inc/core', TARGET, process.cwd())).resolves.toBeUndefined()

		process.env.FAKE_NPM_CREATE_JSON = trustJson({ file: 'wrong.yml' })
		await expect(createPackageTrust('@lena-inc/core', TARGET, process.cwd())).rejects.toThrow(
			'unexpected trust configuration',
		)
	})

	test('returns package-scoped guidance without replaying captured npm output', async () => {
		process.env.FAKE_NPM_EXIT_CODE = '1'
		process.env.FAKE_NPM_STDERR = 'npm error E404 sensitive-registry-detail'

		try {
			await listPackageTrust('@lena-inc/missing', process.cwd())
			throw new Error('Expected listPackageTrust to fail')
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			expect(message).toContain('@lena-inc/missing: package not found')
			expect(message).not.toContain('sensitive-registry-detail')
		}
	})
})

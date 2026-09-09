import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
	createPackageTrust,
	ensureSupportedNpm,
	listPackageTrust,
} from './npm-client'
import type { TrustTarget } from './trust'
import { configureGithub } from './index'

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
		permissions: ['createPackage', 'createStagedPackage'],
		...overrides,
	})
}

beforeEach(async () => {
	fakeDirectory = await mkdtemp(join(tmpdir(), 'npm-trust-client-test-'))
	const executable = join(fakeDirectory, 'npm')
	await Bun.write(
		executable,
		`#!/usr/bin/env -S bun --no-env-file
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (process.env.FAKE_NPM_COMMAND_LOG) appendFileSync(process.env.FAKE_NPM_COMMAND_LOG, JSON.stringify(args) + '\\n')
if (args[0] === '--version') {
  console.log(process.env.FAKE_NPM_VERSION ?? '12.0.2')
  process.exit(0)
}
const isCreate = args[0] === 'trust' && args[1] === 'github'
if (isCreate) {
  // npm 11.16 logs its requested options before printing the created record.
  const option = flag => args[args.indexOf(flag) + 1]
  console.log(JSON.stringify({
    package: args[2],
    file: option('--file'),
    repository: option('--repo'),
    ...(args.includes('--env') ? { environment: option('--env') } : {}),
    permissions: [
      ...(args.includes('--allow-publish') ? ['createPackage'] : []),
      ...(args.includes('--allow-stage-publish') ? ['createStagedPackage'] : []),
    ],
  }, null, 2))
}
if (args[1] === process.env.FAKE_NPM_FAIL_ACTION && args[2] === process.env.FAKE_NPM_FAIL_PACKAGE) {
  console.error('npm error E503 synthetic failure')
  process.exit(1)
}
const exitCode = Number(process.env.FAKE_NPM_EXIT_CODE ?? '0')
if (exitCode !== 0) {
  console.error(process.env.FAKE_NPM_STDERR ?? 'npm failed')
  process.exit(exitCode)
}
if (process.env.FAKE_NPM_STATE_FILE) {
  const file = Bun.file(process.env.FAKE_NPM_STATE_FILE)
  const state = await file.json()
  const name = args[2]
  if (args[1] === 'list') {
    console.log(JSON.stringify(state[name] ?? []))
  } else if (args[1] === 'revoke') {
    const id = args[args.indexOf('--id') + 1]
    state[name] = (state[name] ?? []).filter(record => record.id !== id)
    await Bun.write(file, JSON.stringify(state))
  } else if (isCreate) {
    const created = JSON.parse(process.env.FAKE_NPM_CREATE_JSON)
    state[name] = [created]
    await Bun.write(file, JSON.stringify(state))
    console.log(name === process.env.FAKE_NPM_MALFORMED_CREATE_PACKAGE ? '{ malformed' : JSON.stringify(created))
  }
  process.exit(0)
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
	delete process.env.FAKE_NPM_COMMAND_LOG
	delete process.env.FAKE_NPM_STATE_FILE
	delete process.env.FAKE_NPM_FAIL_ACTION
	delete process.env.FAKE_NPM_FAIL_PACKAGE
	delete process.env.FAKE_NPM_MALFORMED_CREATE_PACKAGE
	await rm(fakeDirectory, { force: true, recursive: true })
})

async function prepareCli(
	state: Record<string, unknown[]>,
	target: TrustTarget = TARGET,
	packageNames = ['@lena-inc/core', '@lena-inc/extra', '@lena-inc/missing'],
): Promise<void> {
	const workflowDirectory = join(fakeDirectory, '.github', 'workflows')
	await mkdir(workflowDirectory, { recursive: true })
	await Bun.write(join(workflowDirectory, target.file), 'name: Publish\n')
	await Bun.write(join(fakeDirectory, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }))
	await Bun.write(join(fakeDirectory, 'bun.lock'), '')
	for (const name of packageNames) {
		const directory = join(fakeDirectory, 'packages', name.split('/').at(-1)!)
		await mkdir(directory, { recursive: true })
		await Bun.write(join(directory, 'package.json'), JSON.stringify({
			name, version: '1.0.0', repository: `https://github.com/${target.repository}`,
		}))
	}
	process.env.FAKE_NPM_STATE_FILE = join(fakeDirectory, 'state.json')
	process.env.FAKE_NPM_COMMAND_LOG = join(fakeDirectory, 'commands.jsonl')
	process.env.FAKE_NPM_CREATE_JSON = trustJson({
		...target, permissions: [...new Set([...target.permissions, 'createStagedPackage'])],
	})
	await Bun.write(process.env.FAKE_NPM_STATE_FILE, JSON.stringify(state))
}

async function runCli(args: string[] = [], target: TrustTarget = TARGET) {
	const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
	const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
	const ci = process.env.CI
	const githubActions = process.env.GITHUB_ACTIONS
	Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
	Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
	process.env.CI = 'false'
	process.env.GITHUB_ACTIONS = 'false'
	const messages: string[] = []
	const log = spyOn(console, 'log').mockImplementation((...values) => { messages.push(values.join(' ')) })
	const sleep = spyOn(Bun, 'sleep').mockResolvedValue(undefined)
	try {
		await configureGithub({
			cwd: fakeDirectory, repo: target.repository, file: target.file, env: target.environment,
			allowPublish: target.permissions.includes('createPackage'),
			allowStagePublish: target.permissions.includes('createStagedPackage'),
			apply: args.includes('--apply'), yes: args.includes('--yes'),
		})
		return { stdout: messages.join('\n'), stderr: '', exitCode: 0 }
	} catch (error) {
		return { stdout: messages.join('\n'), stderr: String(error), exitCode: 1 }
	} finally {
		log.mockRestore()
		sleep.mockRestore()
		if (stdinTty) Object.defineProperty(process.stdin, 'isTTY', stdinTty)
		else Reflect.deleteProperty(process.stdin, 'isTTY')
		if (stdoutTty) Object.defineProperty(process.stdout, 'isTTY', stdoutTty)
		else Reflect.deleteProperty(process.stdout, 'isTTY')
		if (ci === undefined) delete process.env.CI
		else process.env.CI = ci
		if (githubActions === undefined) delete process.env.GITHUB_ACTIONS
		else process.env.GITHUB_ACTIONS = githubActions
	}
}

async function npmCommands(): Promise<string[][]> {
	return (await Bun.file(join(fakeDirectory, 'commands.jsonl')).text()).trim().split('\n').map(line => JSON.parse(line))
}

describe.serial('npm trust CLI replacement', () => {
	test('finishes the seven-package infra batch with npm-added staging and makes no changes on rerun', async () => {
		const target: TrustTarget = { ...TARGET, repository: 'Utilities-Studio/infra', file: 'release-package.yml' }
		const packageNames = ['env-encrypt', 'env-local', 'github-env', 'npm-trust', 'stripe-sync', 'sync-env', 'vite-env']
			.map(name => `@utilities-studio/${name}`)
		const configured = JSON.parse(trustJson({ ...target, permissions: ['createPackage', 'createStagedPackage'] }))
		const state = Object.fromEntries(packageNames.map(name => [name,
			name.endsWith('/npm-trust') ? [] : [{
				...configured,
				environment: name.endsWith('/env-encrypt') ? target.environment : undefined,
			}],
		]))
		await prepareCli(state, target, packageNames)
		process.env.FAKE_NPM_VERSION = '11.16.0'

		const applied = await runCli(['--apply', '--yes'], target)
		expect(applied.exitCode).toBe(0)
		expect(applied.stdout).toContain('Configured 6 packages.')
		expect(applied.stdout).not.toContain('confirmed after retry')
		const mutations = (await npmCommands()).filter(args => ['revoke', 'github'].includes(args[1]))
		expect(mutations.some(args => args[2] === '@utilities-studio/env-encrypt')).toBe(false)
		expect(mutations.filter(args => args[1] === 'revoke')).toHaveLength(5)
		expect(mutations.filter(args => args[1] === 'github')).toHaveLength(6)
		const current = await Bun.file(join(fakeDirectory, 'state.json')).json()
		for (const name of packageNames) expect(current[name]).toEqual([configured])

		const rerun = await runCli(['--apply', '--yes'], target)
		expect(rerun.exitCode).toBe(0)
		expect(rerun.stdout).toContain('All packages already have the requested trust configuration.')
		expect((await npmCommands()).filter(args => ['revoke', 'github'].includes(args[1]))).toEqual(mutations)
	})

	test('confirms a saved record with npm-added staging after creation output cannot be parsed', async () => {
		await prepareCli({})
		process.env.FAKE_NPM_MALFORMED_CREATE_PACKAGE = '@lena-inc/core'
		const result = await runCli(['--apply', '--yes'])
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('@lena-inc/core (confirmed after retry)')
		expect((await npmCommands()).filter(args => args[1] === 'github' && args[2] === '@lena-inc/core')).toHaveLength(1)
	})

	test('replaces direct publishing when only staged publishing is requested', async () => {
		const target: TrustTarget = { ...TARGET, permissions: ['createStagedPackage'] }
		await prepareCli({ '@lena-inc/core': [JSON.parse(trustJson())] }, target)
		const result = await runCli(['--apply', '--yes'], target)
		expect(result.exitCode).toBe(0)
		expect((await npmCommands()).some(args => args[1] === 'revoke' && args[2] === '@lena-inc/core')).toBe(true)
		const state = await Bun.file(join(fakeDirectory, 'state.json')).json()
		for (const records of Object.values(state)) {
			expect(records).toEqual([JSON.parse(trustJson({ permissions: ['createStagedPackage'] }))])
		}
	})

	test('previews replacements without changing trust', async () => {
		const state = { '@lena-inc/core': [JSON.parse(trustJson({ environment: undefined, permissions: ['createPackage', 'createStagedPackage'] }))] }
		await prepareCli(state)
		const result = await runCli()
		expect(result).toMatchObject({ exitCode: 0 })
		expect(result.stdout).toContain('replace')
		expect(result.stdout).toContain('Plan only')
		expect(await Bun.file(join(fakeDirectory, 'state.json')).json()).toEqual(state)
		expect((await npmCommands()).some(args => ['revoke', 'github'].includes(args[1]))).toBe(false)
	})

	test('preflights all packages before replacing, skips exact records, and creates missing records', async () => {
		await prepareCli({
			'@lena-inc/core': [JSON.parse(trustJson({ id: 'old-1', environment: undefined })), { id: 'old-2', type: 'gitlab' }],
			'@lena-inc/extra': [JSON.parse(trustJson())],
		})
		const result = await runCli(['--apply', '--yes'])
		expect(result.exitCode).toBe(0)
		expect(result.stdout).not.toContain('confirmed after retry')
		const commands = await npmCommands()
		const mutations = commands.filter(args => ['revoke', 'github'].includes(args[1]))
		expect(mutations.map(args => args.slice(1, 3))).toEqual([
			['revoke', '@lena-inc/core'], ['revoke', '@lena-inc/core'],
			['github', '@lena-inc/core'], ['github', '@lena-inc/missing'],
		])
		expect(mutations.slice(0, 2).map(args => args[args.indexOf('--id') + 1])).toEqual(['old-1', 'old-2'])
		const preflight = commands.slice(0, commands.indexOf(mutations[0])).filter(args => args[1] === 'list').map(args => args[2])
		expect(new Set(preflight)).toEqual(new Set(['@lena-inc/core', '@lena-inc/extra', '@lena-inc/missing']))
		const state = await Bun.file(join(fakeDirectory, 'state.json')).json()
		for (const records of Object.values(state)) expect(records).toEqual([JSON.parse(trustJson())])
	})

	test('fails preflight without mutations when a replacement record has no ID', async () => {
		await prepareCli({
			'@lena-inc/core': [JSON.parse(trustJson({ file: 'old.yml' }))],
			'@lena-inc/extra': [JSON.parse(trustJson({ id: undefined, file: 'old.yml' }))],
		})
		const result = await runCli(['--apply', '--yes'])
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('cannot replace a trust record without an ID')
		expect((await npmCommands()).some(args => ['revoke', 'github'].includes(args[1]))).toBe(false)
	})

	test('stops on revoke failure before creating anything', async () => {
		const state = { '@lena-inc/core': [JSON.parse(trustJson({ file: 'old.yml' }))] }
		await prepareCli(state)
		process.env.FAKE_NPM_FAIL_ACTION = 'revoke'
		process.env.FAKE_NPM_FAIL_PACKAGE = '@lena-inc/core'
		const result = await runCli(['--apply', '--yes'])
		expect(result.exitCode).toBe(1)
		expect(await Bun.file(join(fakeDirectory, 'state.json')).json()).toEqual(state)
		expect((await npmCommands()).some(args => args[1] === 'github')).toBe(false)
	})

	test('reports partial progress and resumes missing trust after creation fails', async () => {
		await prepareCli({ '@lena-inc/extra': [JSON.parse(trustJson({ file: 'old.yml' }))] })
		process.env.FAKE_NPM_FAIL_ACTION = 'github'
		process.env.FAKE_NPM_FAIL_PACKAGE = '@lena-inc/extra'
		const failed = await runCli(['--apply', '--yes'])
		expect(failed.exitCode).toBe(1)
		expect(failed.stderr).toContain('Completed: @lena-inc/core')
		expect(failed.stderr).toContain('Pending: @lena-inc/extra, @lena-inc/missing')
		expect((await Bun.file(join(fakeDirectory, 'state.json')).json())['@lena-inc/extra']).toEqual([])
		delete process.env.FAKE_NPM_FAIL_ACTION
		delete process.env.FAKE_NPM_FAIL_PACKAGE
		const resumed = await runCli(['--apply', '--yes'])
		expect(resumed.exitCode).toBe(0)
		expect((await npmCommands()).filter(args => args[1] === 'github' && args[2] === '@lena-inc/core')).toHaveLength(1)
	})
})

describe.serial('npm client boundary', () => {
	test('checks the actual npm executable version', async () => {
		process.env.FAKE_NPM_VERSION = '11.15.0'
		expect(await ensureSupportedNpm(process.cwd())).toBe('11.15.0')

		process.env.FAKE_NPM_VERSION = '13.0.0'
		await expect(ensureSupportedNpm(process.cwd())).rejects.toThrow('unsupported')
	})

	test('parses list output and npm creation output with an options preview before the record', async () => {
		process.env.FAKE_NPM_LIST_JSON = trustJson()
		expect(await listPackageTrust('@lena-inc/core', process.cwd())).toHaveLength(1)

		process.env.FAKE_NPM_CREATE_JSON = trustJson()
		await expect(createPackageTrust('@lena-inc/core', TARGET, process.cwd())).resolves.toBeUndefined()
	})

	test.each([
		{ repository: 'another/repo' },
		{ file: 'wrong.yml' },
		{ environment: undefined },
		{ permissions: ['createStagedPackage'] },
	])('rejects a created record that differs from the requested trust: %j', async (overrides) => {
		process.env.FAKE_NPM_CREATE_JSON = trustJson(overrides)
		return expect(createPackageTrust('@lena-inc/core', TARGET, process.cwd())).rejects.toThrow(
			'unexpected trust configuration',
		)
	})

	test('rejects direct-publish access returned for a stage-only request', async () => {
		process.env.FAKE_NPM_CREATE_JSON = trustJson()
		const target: TrustTarget = { ...TARGET, permissions: ['createStagedPackage'] }
		return expect(createPackageTrust('@lena-inc/core', target, process.cwd())).rejects.toThrow(
			'unexpected trust configuration',
		)
	})

	test('does not treat the options preview alone as successful creation', async () => {
		return expect(createPackageTrust('@lena-inc/core', TARGET, process.cwd())).rejects.toThrow(
			'unexpected trust configuration',
		)
	})

	test.each([
		['{ malformed', 'malformed JSON'],
		[trustJson({ type: undefined }), 'Invalid npm trust record'],
	])('rejects invalid records after the options preview: %s', async (output, message) => {
		process.env.FAKE_NPM_CREATE_JSON = output
		return expect(createPackageTrust('@lena-inc/core', TARGET, process.cwd())).rejects.toThrow(message)
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

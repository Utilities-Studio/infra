import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
	createPackageTrust,
	ensureSupportedNpm,
	listPackageTrust,
} from './npm-client'
import type { TrustTarget } from './trust'
import { main } from './index'

const ORIGINAL_PATH = process.env.PATH
const TARGET: TrustTarget = {
	type: 'github',
	repository: 'example-org/example-repo',
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
import { appendFileSync, readFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (process.env.FAKE_NPM_COMMAND_LOG) appendFileSync(process.env.FAKE_NPM_COMMAND_LOG, JSON.stringify(args) + '\\n')
if (args[0] === '--version') {
  console.log(process.env.FAKE_NPM_VERSION ?? '12.0.2')
  process.exit(0)
}
const isCreate = args[0] === 'trust' && args[1] === 'github'
if (args[1] === process.env.FAKE_NPM_REQUIRE_PARALLEL && args.includes('--json')) {
  let overlapping = false
  for (let attempt = 0; attempt < 100; attempt++) {
    const commands = readFileSync(process.env.FAKE_NPM_COMMAND_LOG, 'utf8').trim().split('\\n').map(line => JSON.parse(line))
    overlapping = new Set(commands.filter(command => command[1] === args[1] && command.includes('--json')).map(command => command[2])).size >= 2
    if (overlapping) break
    await Bun.sleep(10)
  }
  if (!overlapping) { console.error('E503: commands did not overlap'); process.exit(1) }
}
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
  const name = args[2]
  const file = Bun.file(process.env.FAKE_NPM_STATE_FILE + '/' + encodeURIComponent(name) + '.json')
  const state = await file.exists() ? await file.json() : []
  if (args[1] === 'list') {
    console.log(JSON.stringify(state))
  } else if (args[1] === 'revoke') {
    const id = args[args.indexOf('--id') + 1]
    await Bun.write(file, JSON.stringify(state.filter(record => record.id !== id)))
  } else if (isCreate) {
    const created = JSON.parse(process.env.FAKE_NPM_CREATE_JSON)
    await Bun.write(file, JSON.stringify([created]))
    console.log(name === process.env.FAKE_NPM_MALFORMED_CREATE_PACKAGE ? '{ malformed' : JSON.stringify(created))
  }
  process.exit(0)
}
const output = isCreate ? process.env.FAKE_NPM_CREATE_JSON : process.env.FAKE_NPM_LIST_JSON
if (output) console.log(output)
`,
	)
	await chmod(executable, 0o755)
	const git = join(fakeDirectory, 'git')
	await Bun.write(git, `#!/usr/bin/env -S bun --no-env-file
if (process.argv.slice(2).join(' ') !== 'remote get-url origin') process.exit(1)
console.log(process.env.FAKE_GIT_REMOTE ?? 'git@github.com:example-org/example-repo.git')
`)
	await chmod(git, 0o755)
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
	delete process.env.FAKE_NPM_REQUIRE_PARALLEL
	delete process.env.FAKE_GIT_REMOTE
	await rm(fakeDirectory, { force: true, recursive: true })
})

async function prepareCli(
	state: Record<string, unknown[]>,
	target: TrustTarget = TARGET,
	packageNames = ['@example/core', '@example/extra', '@example/missing'],
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
	await mkdir(process.env.FAKE_NPM_STATE_FILE)
	for (const [name, records] of Object.entries(state)) {
		await Bun.write(join(process.env.FAKE_NPM_STATE_FILE, `${encodeURIComponent(name)}.json`), JSON.stringify(records))
	}
}

async function fakeState(): Promise<Record<string, unknown[]>> {
	const directory = join(fakeDirectory, 'state.json')
	const entries = await Promise.all((await readdir(directory)).map(async file =>
		[decodeURIComponent(file.slice(0, -5)), await Bun.file(join(directory, file)).json()] as const,
	))
	return Object.fromEntries(entries)
}

async function runCli(args: string[] = [], target?: TrustTarget) {
	const cwd = process.cwd()
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
	try {
		process.chdir(fakeDirectory)
		await main(['bun', 'npm-trust', ...args, ...(target ? [
			'--repo', target.repository, '--file', target.file, '--env', target.environment ?? '',
			...(target.permissions.includes('createPackage') ? ['--allow-publish'] : []),
			...(target.permissions.includes('createStagedPackage') ? ['--allow-stage-publish'] : []),
		] : [])])
		return { stdout: messages.join('\n'), stderr: '', exitCode: 0 }
	} catch (error) {
		return { stdout: messages.join('\n'), stderr: String(error), exitCode: 1 }
	} finally {
		process.chdir(cwd)
		log.mockRestore()
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
	test.each(['list', 'github'])('runs %s for different packages concurrently and applies without another prompt', async (action) => {
		await prepareCli({})
		process.env.FAKE_NPM_REQUIRE_PARALLEL = action
		const result = await runCli()
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('Configured 3 packages.')
		expect(result.stdout).not.toContain('[y/N]')
	})

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

		const applied = await runCli([], target)
		expect(applied.exitCode).toBe(0)
		expect(applied.stdout).toContain('Configured 7 packages.')
		expect(applied.stdout).not.toContain('confirmed after retry')
		const mutations = (await npmCommands()).filter(args => ['revoke', 'github'].includes(args[1]))
		expect(mutations.some(args => args[2] === '@utilities-studio/env-encrypt')).toBe(false)
		expect(mutations.filter(args => args[1] === 'revoke')).toHaveLength(5)
		expect(mutations.filter(args => args[1] === 'github')).toHaveLength(6)
		const current = await fakeState()
		for (const name of packageNames) expect(current[name]).toEqual([configured])

		const rerun = await runCli([], target)
		expect(rerun.exitCode).toBe(0)
		expect(rerun.stdout).toContain('Configured 7 packages.')
		expect((await npmCommands()).filter(args => ['revoke', 'github'].includes(args[1]))).toEqual(mutations)
	})

	test('confirms a saved record with npm-added staging after creation output cannot be parsed', async () => {
		await prepareCli({})
		process.env.FAKE_NPM_MALFORMED_CREATE_PACKAGE = '@example/core'
		const result = await runCli()
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('@example/core (confirmed after retry)')
		expect((await npmCommands()).filter(args => args[1] === 'github' && args[2] === '@example/core')).toHaveLength(1)
	})

	test('replaces direct publishing when only staged publishing is requested', async () => {
		const target: TrustTarget = { ...TARGET, permissions: ['createStagedPackage'] }
		await prepareCli({ '@example/core': [JSON.parse(trustJson())] }, target)
		const result = await runCli([], target)
		expect(result.exitCode).toBe(0)
		expect((await npmCommands()).some(args => args[1] === 'revoke' && args[2] === '@example/core')).toBe(true)
		const state = await fakeState()
		for (const records of Object.values(state)) {
			expect(records).toEqual([JSON.parse(trustJson({ permissions: ['createStagedPackage'] }))])
		}
	})

	test('bare invocation detects origin and replaces differing trust immediately', async () => {
		const state = { '@example/core': [JSON.parse(trustJson({ environment: undefined, permissions: ['createPackage', 'createStagedPackage'] }))] }
		await prepareCli(state)
		const result = await runCli()
		expect(result).toMatchObject({ exitCode: 0 })
		expect(result.stdout).toContain('example-org/example-repo, publish.yml, environment=npm-publish, permissions=createPackage')
		expect(result.stdout).not.toContain('Plan only')
		expect((await fakeState())['@example/core']).toEqual([JSON.parse(trustJson())])
		expect((await npmCommands()).some(args => args[1] === 'revoke' && args[2] === '@example/core')).toBe(true)
	})

	test('checks each package before replacing, skips exact records, and creates missing records', async () => {
		await prepareCli({
			'@example/core': [JSON.parse(trustJson({ id: 'old-1', environment: undefined })), { id: 'old-2', type: 'gitlab' }],
			'@example/extra': [JSON.parse(trustJson())],
		})
		const result = await runCli()
		expect(result.exitCode).toBe(0)
		expect(result.stdout).not.toContain('confirmed after retry')
		const commands = await npmCommands()
		const mutations = commands.filter(args => ['revoke', 'github'].includes(args[1]))
		const core = mutations.filter(args => args[2] === '@example/core')
		expect(core.map(args => args[1])).toEqual(['revoke', 'revoke', 'github'])
		expect(core.slice(0, 2).map(args => args[args.indexOf('--id') + 1])).toEqual(['old-1', 'old-2'])
		expect(mutations.filter(args => args[2] === '@example/missing').map(args => args[1])).toEqual(['github'])
		expect(mutations.some(args => args[2] === '@example/extra')).toBe(false)
		for (const mutation of mutations) {
			expect(commands.slice(0, commands.indexOf(mutation)).some(args => args[1] === 'list' && args[2] === mutation[2])).toBe(true)
		}
		const state = await fakeState()
		for (const records of Object.values(state)) expect(records).toEqual([JSON.parse(trustJson())])
	})

	test('continues other packages when a replacement record has no ID', async () => {
		await prepareCli({
			'@example/core': [JSON.parse(trustJson({ file: 'old.yml' }))],
			'@example/extra': [JSON.parse(trustJson({ id: undefined, file: 'old.yml' }))],
		})
		const result = await runCli()
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('cannot replace a trust record without an ID')
		expect(result.stderr).toContain('Completed: @example/core, @example/missing')
		expect(result.stderr).toContain('Pending: @example/extra')
		expect((await fakeState())['@example/core']).toEqual([JSON.parse(trustJson())])
		expect((await fakeState())['@example/missing']).toEqual([JSON.parse(trustJson())])
	})

	test.each(['@example/core', '@example/extra'])('continues all other packages when npm access fails for %s', async (name) => {
		await prepareCli({})
		process.env.FAKE_NPM_FAIL_ACTION = 'list'
		process.env.FAKE_NPM_FAIL_PACKAGE = name
		const result = await runCli()
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain(`Pending: ${name}`)
		const state = await fakeState()
		for (const other of ['@example/core', '@example/extra', '@example/missing'].filter(value => value !== name)) {
			expect(state[other]).toEqual([JSON.parse(trustJson())])
		}
	})

	test('keeps optional github and repository overrides and rejects removed confirmation flags', async () => {
		await prepareCli({})
		process.env.FAKE_GIT_REMOTE = 'https://gitlab.com/unrelated/project.git'
		expect((await runCli(['github'], TARGET)).exitCode).toBe(0)
		expect((await runCli(['--apply'])).stderr).toContain('Unknown option')
		expect((await runCli(['--yes'])).stderr).toContain('Unknown option')
	})

	test('rejects an unrelated remote before contacting npm', async () => {
		await prepareCli({})
		process.env.FAKE_GIT_REMOTE = 'https://gitlab.com/unrelated/project.git'
		expect((await runCli()).stderr).toContain('Cannot detect a GitHub repository from origin')
		expect(await Bun.file(join(fakeDirectory, 'commands.jsonl')).exists()).toBe(false)
	})

	test('stops the failed package after revoke failure and finishes independent packages', async () => {
		const state = { '@example/core': [JSON.parse(trustJson({ file: 'old.yml' }))] }
		await prepareCli(state)
		process.env.FAKE_NPM_FAIL_ACTION = 'revoke'
		process.env.FAKE_NPM_FAIL_PACKAGE = '@example/core'
		const result = await runCli()
		expect(result.exitCode).toBe(1)
		expect((await fakeState())['@example/core']).toEqual(state['@example/core'])
		expect((await npmCommands()).some(args => args[1] === 'github' && args[2] === '@example/core')).toBe(false)
		expect(result.stderr).toContain('Completed: @example/extra, @example/missing')
		expect(result.stderr).toContain('Pending: @example/core')
	})

	test('reports partial progress and resumes missing trust after creation fails', async () => {
		await prepareCli({ '@example/extra': [JSON.parse(trustJson({ file: 'old.yml' }))] })
		process.env.FAKE_NPM_FAIL_ACTION = 'github'
		process.env.FAKE_NPM_FAIL_PACKAGE = '@example/extra'
		const failed = await runCli()
		expect(failed.exitCode).toBe(1)
		expect(failed.stderr).toContain('Completed: @example/core, @example/missing')
		expect(failed.stderr).toContain('Pending: @example/extra')
		expect((await fakeState())['@example/extra']).toEqual([])
		delete process.env.FAKE_NPM_FAIL_ACTION
		delete process.env.FAKE_NPM_FAIL_PACKAGE
		const resumed = await runCli()
		expect(resumed.exitCode).toBe(0)
		expect((await npmCommands()).filter(args => args[1] === 'github' && args[2] === '@example/core')).toHaveLength(1)
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
		expect(await listPackageTrust('@example/core', process.cwd())).toHaveLength(1)

		process.env.FAKE_NPM_CREATE_JSON = trustJson()
		await expect(createPackageTrust('@example/core', TARGET, process.cwd())).resolves.toBeUndefined()
	})

	test.each([
		{ repository: 'another/repo' },
		{ file: 'wrong.yml' },
		{ environment: undefined },
		{ permissions: ['createStagedPackage'] },
	])('rejects a created record that differs from the requested trust: %j', async (overrides) => {
		process.env.FAKE_NPM_CREATE_JSON = trustJson(overrides)
		return expect(createPackageTrust('@example/core', TARGET, process.cwd())).rejects.toThrow(
			'unexpected trust configuration',
		)
	})

	test('rejects direct-publish access returned for a stage-only request', async () => {
		process.env.FAKE_NPM_CREATE_JSON = trustJson()
		const target: TrustTarget = { ...TARGET, permissions: ['createStagedPackage'] }
		return expect(createPackageTrust('@example/core', target, process.cwd())).rejects.toThrow(
			'unexpected trust configuration',
		)
	})

	test('does not treat the options preview alone as successful creation', async () => {
		return expect(createPackageTrust('@example/core', TARGET, process.cwd())).rejects.toThrow(
			'unexpected trust configuration',
		)
	})

	test.each([
		['{ malformed', 'malformed JSON'],
		[trustJson({ type: undefined }), 'Invalid npm trust record'],
	])('rejects invalid records after the options preview: %s', async (output, message) => {
		process.env.FAKE_NPM_CREATE_JSON = output
		return expect(createPackageTrust('@example/core', TARGET, process.cwd())).rejects.toThrow(message)
	})

	test('returns package-scoped guidance without replaying captured npm output', async () => {
		process.env.FAKE_NPM_EXIT_CODE = '1'
		process.env.FAKE_NPM_STDERR = 'npm error E404 sensitive-registry-detail'

		try {
			await listPackageTrust('@example/missing', process.cwd())
			throw new Error('Expected listPackageTrust to fail')
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			expect(message).toContain('@example/missing: package not found')
			expect(message).not.toContain('sensitive-registry-detail')
		}
	})
})

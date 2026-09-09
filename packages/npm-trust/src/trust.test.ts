import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { isSupportedNpmVersion } from './npm-client'
import {
	createTrustArguments,
	createTrustTarget,
	discoverPublishablePackages,
	listTrustArguments,
	matchesTrustTarget,
	parseTrustList,
	planPackageTrust,
	revokeTrustArguments,
	setupOptionsSchema,
	type GithubTrustConfiguration,
	type PublishablePackage,
	type SetupOptions,
	type TrustTarget,
} from './trust'

const temporaryDirectories: string[] = []

const OPTIONS: SetupOptions = {
	allowPublish: true,
	allowStagePublish: false,
	apply: false,
	cwd: '/repo',
	environment: 'npm-publish',
	file: 'publish.yml',
	repository: 'utilities-studio/lena',
	yes: false,
}

const TARGET: TrustTarget = {
	type: 'github',
	repository: 'utilities-studio/lena',
	file: 'publish.yml',
	environment: 'npm-publish',
	permissions: ['createPackage'],
}

const PACKAGE: PublishablePackage = {
	dir: '/repo/packages/core',
	name: '@lena-inc/core',
	relativeDir: 'packages/core',
}

const EXACT_CONFIGURATION = {
	type: 'github',
	id: 'trust-1',
	repository: 'utilities-studio/lena',
	file: 'publish.yml',
	environment: 'npm-publish',
	permissions: ['createPackage'],
} satisfies GithubTrustConfiguration

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function temporaryRepository(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'npm-trust-test-'))
	temporaryDirectories.push(directory)
	await mkdir(join(directory, '.github', 'workflows'), { recursive: true })
	await Bun.write(join(directory, '.github', 'workflows', 'publish.yml'), 'name: Publish\n')
	return directory
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`)
}

describe('setup options', () => {
	test('requires an explicit publishing permission', () => {
		const parsed = setupOptionsSchema.safeParse({
			...OPTIONS,
			allowPublish: false,
		})

		expect(parsed.success).toBe(false)
	})

	test('rejects workflow paths and confirmation without apply', () => {
		expect(setupOptionsSchema.safeParse({ ...OPTIONS, file: 'nested/publish.yml' }).success).toBe(false)
		expect(setupOptionsSchema.safeParse({ ...OPTIONS, yes: true }).success).toBe(false)
	})

	test('builds an exact target from validated options', () => {
		expect(createTrustTarget(OPTIONS)).toEqual(TARGET)
	})
})

describe('npm command arguments', () => {
	test('keeps scoped package names as one argument', () => {
		expect(listTrustArguments('@lena-inc/core')).toEqual([
			'trust',
			'list',
			'@lena-inc/core',
			'--json',
			'--registry',
			'https://registry.npmjs.org',
		])
	})

	test('creates the requested GitHub trust configuration without a shell', () => {
		expect(createTrustArguments('@lena-inc/core', TARGET)).toEqual([
			'trust',
			'github',
			'@lena-inc/core',
			'--repo',
			'utilities-studio/lena',
			'--file',
			'publish.yml',
			'--env',
			'npm-publish',
			'--allow-publish',
			'--yes',
			'--json',
			'--registry',
			'https://registry.npmjs.org',
		])
	})

	test('revokes only the specified package trust ID', () => {
		expect(revokeTrustArguments('@lena-inc/core', 'trust-1')).toEqual([
			'trust', 'revoke', '@lena-inc/core', '--id', 'trust-1', '--yes', '--json', '--registry',
			'https://registry.npmjs.org',
		])
	})
})

describe('npm trust output', () => {
	test('accepts blank, object, array, and concatenated object output', () => {
		expect(parseTrustList('')).toEqual([])
		expect(parseTrustList(JSON.stringify(EXACT_CONFIGURATION))).toEqual([EXACT_CONFIGURATION])
		expect(parseTrustList(JSON.stringify([EXACT_CONFIGURATION]))).toEqual([EXACT_CONFIGURATION])

		const second = {
			...EXACT_CONFIGURATION,
			id: 'trust-2',
			file: 'release-{safe}.yaml',
		}
		const concatenated = `${JSON.stringify(EXACT_CONFIGURATION, null, 2)}\n${JSON.stringify(second, null, 2)}`
		expect(parseTrustList(concatenated)).toEqual([EXACT_CONFIGURATION, second])
	})

	test('retains foreign providers only as sanitized replacement metadata', () => {
		expect(parseTrustList('{"id":"other-1","type":"gitlab","untrusted":"value"}')).toEqual([
			{ id: 'other-1', provider: 'gitlab', type: 'other' },
		])
	})

	test('rejects malformed and unexpected GitHub records', () => {
		expect(() => parseTrustList('{"type":"github"}')).toThrow('Invalid npm GitHub trust record')
		expect(() => parseTrustList(`${JSON.stringify(EXACT_CONFIGURATION)} trailing`)).toThrow(
			'malformed JSON',
		)
		expect(() =>
			parseTrustList(JSON.stringify({ ...EXACT_CONFIGURATION, unexpected: true })),
		).toThrow('Invalid npm GitHub trust record')
	})
})

describe('trust planning', () => {
	test.each([
		[['createPackage'], ['createPackage'], true],
		[['createPackage'], ['createStagedPackage'], false],
		[['createPackage'], ['createPackage', 'createStagedPackage'], true],
		[['createStagedPackage'], ['createPackage'], false],
		[['createStagedPackage'], ['createStagedPackage'], true],
		[['createStagedPackage'], ['createPackage', 'createStagedPackage'], false],
		[['createPackage', 'createStagedPackage'], ['createPackage'], false],
		[['createPackage', 'createStagedPackage'], ['createStagedPackage'], false],
		[['createPackage', 'createStagedPackage'], ['createPackage', 'createStagedPackage'], true],
	] as const)('matches requested permissions %j against npm permissions %j: %s', (requested, granted, matches) => {
		const target: TrustTarget = { ...TARGET, permissions: [...requested] }
		const configuration: GithubTrustConfiguration = { ...EXACT_CONFIGURATION, permissions: [...granted] }
		expect(matchesTrustTarget(configuration, target)).toBe(matches)
		expect(planPackageTrust(PACKAGE, [configuration], target).action).toBe(matches ? 'unchanged' : 'replace')
	})

	test('matches permissions independent of order but keeps every field exact', () => {
		const target: TrustTarget = {
			...TARGET,
			permissions: ['createPackage', 'createStagedPackage'],
		}
		const reordered: GithubTrustConfiguration = {
			...EXACT_CONFIGURATION,
			permissions: ['createStagedPackage', 'createPackage'],
		}

		expect(matchesTrustTarget(reordered, target)).toBe(true)
		expect(matchesTrustTarget({ ...reordered, environment: undefined }, target)).toBe(false)
		expect(matchesTrustTarget({ ...reordered, repository: 'Utilities-Studio/lena' }, target)).toBe(false)
		expect(matchesTrustTarget({ ...reordered, permissions: ['createPackage'] }, target)).toBe(false)
	})

	test('creates missing records, skips exact records, and replaces drift', () => {
		expect(planPackageTrust(PACKAGE, [], TARGET)).toEqual({ action: 'create', package: PACKAGE })
		expect(planPackageTrust(PACKAGE, [EXACT_CONFIGURATION], TARGET)).toEqual({
			action: 'unchanged',
			package: PACKAGE,
		})

		const drifted = { ...EXACT_CONFIGURATION, file: 'other.yml' }
		expect(planPackageTrust(PACKAGE, [drifted], TARGET)).toEqual({
			action: 'replace',
			configurations: [drifted],
			package: PACKAGE,
		})
	})

	test('replaces additional publishers with the requested configuration', () => {
		const foreign = { id: 'other-1', provider: 'gitlab', type: 'other' as const }
		expect(planPackageTrust(PACKAGE, [EXACT_CONFIGURATION, foreign], TARGET)).toEqual({
			action: 'replace',
			configurations: [EXACT_CONFIGURATION, foreign],
			package: PACKAGE,
		})
	})

	test('replaces an unscoped environment even with npm-added staging permissions', () => {
		const existing = {
			...EXACT_CONFIGURATION,
			environment: undefined,
			permissions: ['createPackage', 'createStagedPackage'] as const,
		}
		expect(planPackageTrust(PACKAGE, [{ ...existing, permissions: [...existing.permissions] }], TARGET).action).toBe('replace')
	})

	test('rejects replacement records without IDs during preflight', () => {
		expect(() => planPackageTrust(PACKAGE, [{ ...EXACT_CONFIGURATION, id: undefined, file: 'old.yml' }], TARGET)).toThrow('cannot replace a trust record without an ID')
	})
})

describe('repository discovery', () => {
	test('discovers a normal single-package repository once', async () => {
		const root = await temporaryRepository()
		await writeJson(join(root, 'package.json'), {
			name: '@example/single',
			version: '1.0.0',
			repository: 'git+https://github.com/example/project.git',
		})

		const discovered = await discoverPublishablePackages(root, 'example/project', 'publish.yml')
		expect(discovered.packages).toEqual([
			{ dir: root, name: '@example/single', relativeDir: '.' },
		])
	})

	test('discovers and sorts public workspaces while skipping the private root', async () => {
		const root = await temporaryRepository()
		await mkdir(join(root, 'packages', 'a'), { recursive: true })
		await mkdir(join(root, 'packages', 'z'), { recursive: true })
		await writeJson(join(root, 'package.json'), {
			private: true,
			version: '1.0.0',
			workspaces: ['packages/*'],
		})
		await Bun.write(join(root, 'bun.lock'), '')
		await writeJson(join(root, 'packages', 'z', 'package.json'), {
			name: '@example/z',
			version: '1.0.0',
			repository: { type: 'git', url: 'https://github.com/example/project' },
		})
		await writeJson(join(root, 'packages', 'a', 'package.json'), {
			name: '@example/a',
			version: '1.0.0',
			repository: { type: 'git', url: 'https://github.com/example/project.git' },
		})

		const discovered = await discoverPublishablePackages(root, 'example/project', 'publish.yml')
		expect(discovered.packages.map((package_) => package_.name)).toEqual([
			'@example/a',
			'@example/z',
		])
	})

	test('rejects malformed private markers instead of publishing them', async () => {
		const root = await temporaryRepository()
		await writeJson(join(root, 'package.json'), {
			name: '@example/single',
			private: 'true',
			repository: 'https://github.com/example/project',
			version: '1.0.0',
		})

		await expect(
			discoverPublishablePackages(root, 'example/project', 'publish.yml'),
		).rejects.toThrow('Invalid')
	})

	test('fails locally on repository, registry, or workflow drift', async () => {
		const root = await temporaryRepository()
		await writeJson(join(root, 'package.json'), {
			name: '@example/single',
			version: '1.0.0',
			repository: 'https://github.com/example/wrong',
		})

		await expect(
			discoverPublishablePackages(root, 'example/project', 'publish.yml'),
		).rejects.toThrow('repository does not match')

		await writeJson(join(root, 'package.json'), {
			name: '@example/single',
			version: '1.0.0',
			repository: 'https://github.com/Example/project',
		})

		await expect(
			discoverPublishablePackages(root, 'example/project', 'publish.yml'),
		).rejects.toThrow('repository does not match')

		await writeJson(join(root, 'package.json'), {
			name: '@example/single',
			version: '1.0.0',
			repository: 'https://github.com/example/project',
			publishConfig: { registry: 'https://npm.pkg.github.com' },
		})

		await expect(
			discoverPublishablePackages(root, 'example/project', 'publish.yml'),
		).rejects.toThrow('publishConfig.registry')
		await expect(
			discoverPublishablePackages(root, 'example/project', 'missing.yml'),
		).rejects.toThrow('Workflow not found')
		await expect(
			discoverPublishablePackages(root, 'example/project', 'Publish.yml'),
		).rejects.toThrow('Workflow not found')
	})
})

describe('npm version compatibility', () => {
	test('supports only the validated npm trust output contract', () => {
		expect(isSupportedNpmVersion('11.14.0')).toBe(false)
		expect(isSupportedNpmVersion('11.15.0')).toBe(true)
		expect(isSupportedNpmVersion('12.0.2')).toBe(true)
		expect(isSupportedNpmVersion('13.0.0-beta.1')).toBe(false)
		expect(isSupportedNpmVersion('13.0.0')).toBe(false)
	})
})

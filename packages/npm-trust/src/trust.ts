import { getPackages } from '@manypkg/get-packages'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'

export const NPM_REGISTRY = 'https://registry.npmjs.org'

const githubRepositorySchema = z
	.string()
	.trim()
	.regex(
		/^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?\/[A-Za-z0-9_.-]+$/,
		'Expected owner/repository',
	)

const workflowFileSchema = z
	.string()
	.trim()
	.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/, 'Expected a workflow filename ending in .yml or .yaml')

export const setupOptionsSchema = z
	.strictObject({
		allowPublish: z.boolean(),
		allowStagePublish: z.boolean(),
		apply: z.boolean(),
		cwd: z.string().trim().min(1),
		environment: z.string().trim().min(1).max(255).optional(),
		file: workflowFileSchema,
		repository: githubRepositorySchema,
		yes: z.boolean(),
	})
	.superRefine((value, context) => {
		if (!value.allowPublish && !value.allowStagePublish) {
			context.addIssue({
				code: 'custom',
				message: 'Select --allow-publish, --allow-stage-publish, or both',
				path: ['allowPublish'],
			})
		}

		if (value.yes && !value.apply) {
			context.addIssue({
				code: 'custom',
				message: '--yes is valid only with --apply',
				path: ['yes'],
			})
		}
	})

export type SetupOptions = z.output<typeof setupOptionsSchema>

const repositoryFieldSchema = z.union([
	z.string().trim().min(1),
	z.object({
		type: z.string().trim().min(1).optional(),
		url: z.string().trim().min(1),
	}),
])

const privatePackageManifestSchema = z.object({ private: z.literal(true) })

const packageManifestSchema = z.object({
	name: z.string().trim().min(1),
	private: z.literal(false).optional(),
	publishConfig: z
		.object({
			registry: z.string().trim().min(1).optional(),
		})
		.optional(),
	repository: repositoryFieldSchema.optional(),
})

export type PublishablePackage = {
	dir: string
	name: string
	relativeDir: string
}

export type TrustPermission = 'createPackage' | 'createStagedPackage'

export type TrustTarget = {
	environment?: string
	file: string
	permissions: TrustPermission[]
	repository: string
	type: 'github'
}

const permissionSchema = z.enum(['createPackage', 'createStagedPackage'])

const githubTrustConfigurationSchema = z.strictObject({
	environment: z.string().min(1).optional(),
	file: z.string().min(1),
	id: z.string().min(1).optional(),
	permissions: z.array(permissionSchema).min(1),
	repository: z.string().min(1),
	type: z.literal('github'),
})

const trustConfigurationTypeSchema = z.object({
	id: z.string().min(1).optional(),
	type: z.string().min(1),
})

export type GithubTrustConfiguration = z.output<typeof githubTrustConfigurationSchema>

export type ForeignTrustConfiguration = {
	id?: string
	provider: string
	type: 'other'
}

export type TrustConfiguration = GithubTrustConfiguration | ForeignTrustConfiguration

export type PackageTrustPlan =
	| {
			action: 'create'
			package: PublishablePackage
	  }
	| {
			action: 'unchanged'
			package: PublishablePackage
	  }
	| {
			action: 'conflict'
			configurations: TrustConfiguration[]
			package: PublishablePackage
	  }

function zodIssueSummary(error: z.ZodError): string {
	return error.issues
		.map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
		.join('; ')
}

function normalizeRegistry(value: string): string {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new Error(`Invalid publishConfig.registry: ${value}`)
	}

	return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`.toLowerCase()
}

function normalizeGitHubRepository(value: z.output<typeof repositoryFieldSchema>): string | null {
	const repository = typeof value === 'string' ? value : value.url
	const withoutGitPrefix = repository.replace(/^git\+/, '')
	const shorthand = withoutGitPrefix.match(/^github:([^/]+\/[^/]+)$/i)
	const scp = withoutGitPrefix.match(/^git@github\.com:([^/]+\/[^/]+)$/i)

	if (shorthand || scp) {
		return (shorthand?.[1] ?? scp?.[1] ?? '').replace(/\.git$/, '').replace(/\/$/, '')
	}

	let url: URL
	try {
		url = new URL(withoutGitPrefix)
	} catch {
		return null
	}

	if (url.hostname.toLowerCase() !== 'github.com') return null

	const path = url.pathname.replace(/^\//, '').replace(/\/$/, '').replace(/\.git$/, '')
	return githubRepositorySchema.safeParse(path).success ? path : null
}

async function readPackageManifest(packageDir: string) {
	let value: unknown
	try {
		value = await Bun.file(join(packageDir, 'package.json')).json()
	} catch {
		throw new Error(`Cannot read ${join(packageDir, 'package.json')}`)
	}

	if (privatePackageManifestSchema.safeParse(value).success) return null

	const parsed = packageManifestSchema.safeParse(value)
	if (!parsed.success) {
		throw new Error(`Invalid ${join(packageDir, 'package.json')}: ${zodIssueSummary(parsed.error)}`)
	}

	return parsed.data
}

export async function discoverPublishablePackages(
	cwd: string,
	repository: string,
	workflowFile: string,
): Promise<{ packages: PublishablePackage[]; rootDir: string }> {
	const discovered = await getPackages(resolve(cwd))
	const workflowDirectory = join(discovered.rootDir, '.github', 'workflows')
	const workflowPath = join(workflowDirectory, workflowFile)
	let workflowFiles: string[]
	try {
		workflowFiles = await readdir(workflowDirectory)
	} catch {
		workflowFiles = []
	}

	if (!workflowFiles.includes(workflowFile)) {
		throw new Error(`Workflow not found: ${workflowPath}`)
	}

	const candidates = [discovered.rootPackage, ...discovered.packages].filter(
		(candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate),
	)
	const byDirectory = new Map(candidates.map((candidate) => [candidate.dir, candidate]))
	const packages: PublishablePackage[] = []
	const names = new Set<string>()

	for (const candidate of byDirectory.values()) {
		const manifest = await readPackageManifest(candidate.dir)
		if (!manifest) continue

		if (names.has(manifest.name)) {
			throw new Error(`Duplicate package name: ${manifest.name}`)
		}

		if (!manifest.repository) {
			throw new Error(`${manifest.name}: package.json repository is required by npm trusted publishing`)
		}

		const manifestRepository = normalizeGitHubRepository(manifest.repository)
		if (!manifestRepository || manifestRepository !== repository) {
			throw new Error(
				`${manifest.name}: package.json repository does not match ${repository}`,
			)
		}

		const registry = manifest.publishConfig?.registry
		if (registry && normalizeRegistry(registry) !== normalizeRegistry(NPM_REGISTRY)) {
			throw new Error(`${manifest.name}: publishConfig.registry must target ${NPM_REGISTRY}`)
		}

		names.add(manifest.name)
		packages.push({
			dir: candidate.dir,
			name: manifest.name,
			relativeDir: candidate.relativeDir,
		})
	}

	if (packages.length === 0) {
		throw new Error(`No publishable packages found under ${discovered.rootDir}`)
	}

	packages.sort((left, right) => left.name.localeCompare(right.name))
	return { packages, rootDir: discovered.rootDir }
}

export function createTrustTarget(options: SetupOptions): TrustTarget {
	const permissions: TrustPermission[] = []
	if (options.allowPublish) permissions.push('createPackage')
	if (options.allowStagePublish) permissions.push('createStagedPackage')

	return {
		type: 'github',
		repository: options.repository,
		file: options.file,
		...(options.environment ? { environment: options.environment } : {}),
		permissions,
	}
}

// npm currently prints one JSON document per trust record. JSON.parse cannot
// read concatenated documents, and npm exposes no structured workspace API.
function parseJsonDocuments(input: string): unknown[] {
	const values: unknown[] = []
	let depth = 0
	let escaped = false
	let inString = false
	let start = -1

	for (let index = 0; index < input.length; index++) {
		const character = input[index]

		if (start === -1) {
			if (/\s/.test(character)) continue
			if (character !== '{' && character !== '[') {
				throw new Error('npm trust returned malformed JSON')
			}
			start = index
		}

		if (inString) {
			if (escaped) {
				escaped = false
			} else if (character === '\\') {
				escaped = true
			} else if (character === '"') {
				inString = false
			}
			continue
		}

		if (character === '"') {
			inString = true
			continue
		}

		if (character === '{' || character === '[') depth++
		if (character === '}' || character === ']') depth--

		if (depth < 0) throw new Error('npm trust returned malformed JSON')
		if (depth !== 0 || start === -1) continue

		try {
			values.push(JSON.parse(input.slice(start, index + 1)) as unknown)
		} catch {
			throw new Error('npm trust returned malformed JSON')
		}
		start = -1
	}

	if (start !== -1 || depth !== 0 || inString) {
		throw new Error('npm trust returned malformed JSON')
	}

	return values.flatMap((value) => (Array.isArray(value) ? value : [value]))
}

export function parseTrustList(input: string): TrustConfiguration[] {
	if (!input.trim()) return []

	return parseJsonDocuments(input).map((value, index) => {
		const type = trustConfigurationTypeSchema.safeParse(value)
		if (!type.success) {
			throw new Error(`Invalid npm trust record ${index + 1}: ${zodIssueSummary(type.error)}`)
		}

		if (type.data.type !== 'github') {
			return {
				type: 'other',
				provider: type.data.type,
				...(type.data.id ? { id: type.data.id } : {}),
			}
		}

		const configuration = githubTrustConfigurationSchema.safeParse(value)
		if (!configuration.success) {
			throw new Error(
				`Invalid npm GitHub trust record ${index + 1}: ${zodIssueSummary(configuration.error)}`,
			)
		}

		return configuration.data
	})
}

export function isExactTrustConfiguration(
	configuration: TrustConfiguration,
	target: TrustTarget,
): configuration is GithubTrustConfiguration {
	if (configuration.type !== 'github') return false

	return (
		configuration.repository === target.repository &&
		configuration.file === target.file &&
		configuration.environment === target.environment &&
		[...configuration.permissions].sort().join('\0') === [...target.permissions].sort().join('\0')
	)
}

export function planPackageTrust(
	package_: PublishablePackage,
	configurations: TrustConfiguration[],
	target: TrustTarget,
): PackageTrustPlan {
	const exactIndex = configurations.findIndex((configuration) =>
		isExactTrustConfiguration(configuration, target),
	)

	if (exactIndex >= 0 && configurations.length === 1) {
		return { action: 'unchanged', package: package_ }
	}

	if (configurations.length === 0) {
		return { action: 'create', package: package_ }
	}

	return { action: 'conflict', configurations, package: package_ }
}

export function listTrustArguments(packageName: string): string[] {
	return ['trust', 'list', packageName, '--json', '--registry', NPM_REGISTRY]
}

export function interactiveTrustArguments(packageName: string): string[] {
	return ['trust', 'list', packageName, '--registry', NPM_REGISTRY]
}

export function createTrustArguments(packageName: string, target: TrustTarget): string[] {
	return [
		'trust',
		'github',
		packageName,
		'--repo',
		target.repository,
		'--file',
		target.file,
		...(target.environment ? ['--env', target.environment] : []),
		...(target.permissions.includes('createPackage') ? ['--allow-publish'] : []),
		...(target.permissions.includes('createStagedPackage') ? ['--allow-stage-publish'] : []),
		'--yes',
		'--json',
		'--registry',
		NPM_REGISTRY,
	]
}

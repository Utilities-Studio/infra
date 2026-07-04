import { beforeAll, describe, expect, test } from 'bun:test'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const repoDir = resolve(packageDir, '../..')

type PackageJson = {
	exports?: {
		'./secret-keys'?: {
			import?: string
			require?: string
			types?: string
		}
	}
	files?: string[]
	scripts?: Record<string, string>
}

async function readPackageJson(): Promise<PackageJson> {
	return (await Bun.file(join(packageDir, 'package.json')).json()) as PackageJson
}

async function run(command: string[], cwd = packageDir): Promise<{ exitCode: number; stderr: string; stdout: string }> {
	const proc = Bun.spawn(command, {
		cwd,
		stderr: 'pipe',
		stdout: 'pipe'
	})
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	])

	return { exitCode, stderr, stdout }
}

describe('sync-env package contract', () => {
	test('exports secret-keys from generated dist files for Node consumers', async () => {
		const pkg = await readPackageJson()

		expect(pkg.exports?.['./secret-keys']).toEqual({
			types: './dist/secret-keys.d.ts',
			import: './dist/secret-keys.js',
			require: './dist/secret-keys.cjs'
		})
		expect(pkg.files).toContain('dist')
	})

	test('has a package build script for generated Node artifacts', async () => {
		const pkg = await readPackageJson()

		expect(pkg.scripts?.build).toBe('tsup src/secret-keys.ts --format esm,cjs --dts --out-dir dist --clean')
		expect(await Bun.file(join(packageDir, 'scripts/build-secret-keys.ts')).exists()).toBe(false)
	})

	test('keeps generated package dist output ignored in source control', async () => {
		const gitignore = await Bun.file(join(repoDir, '.gitignore')).text()

		expect(gitignore).toContain('packages/*/dist/')
	})

	test('release workflow runs package builds before npm publish', async () => {
		const workflow = await Bun.file(join(repoDir, '.github/workflows/release-package.yml')).text()
		const buildIndex = workflow.indexOf('bun run build')
		const publishIndex = workflow.indexOf('npm publish --access public')

		expect(buildIndex).toBeGreaterThan(0)
		expect(publishIndex).toBeGreaterThan(buildIndex)
	})
})

describe('built secret-keys Node export', () => {
	beforeAll(async () => {
		const result = await run(['bun', 'run', 'build'])
		if (result.exitCode !== 0) {
			throw new Error(result.stderr || result.stdout || 'bun run build failed')
		}
	})

	test('exports a Node ESM runtime subpath', async () => {
		const result = await run([
			'node',
			'-e',
			`
				const resolved = import.meta.resolve('@utilities-studio/sync-env/secret-keys')
				const mod = await import('@utilities-studio/sync-env/secret-keys')
				console.log(resolved.endsWith('/dist/secret-keys.js'), mod.isSecretKey('AWS_SECRET_ACCESS_KEY'), mod.isSecretKey('VITE_SITE_URL'))
			`
		])

		expect(result.stderr).toBe('')
		expect(result.exitCode).toBe(0)
		expect(result.stdout.trim()).toBe('true true false')
	})

	test('exports a Node CommonJS runtime subpath for Pulumi projects compiled to require', async () => {
		const result = await run([
			'node',
			'-e',
			`
				const mod = require('@utilities-studio/sync-env/secret-keys')
				console.log(require.resolve('@utilities-studio/sync-env/secret-keys').endsWith('/dist/secret-keys.cjs'), mod.isSecretKey('AWS_SECRET_ACCESS_KEY'), mod.isSecretKey('VITE_SITE_URL'))
			`
		])

		expect(result.stderr).toBe('')
		expect(result.exitCode).toBe(0)
		expect(result.stdout.trim()).toBe('true true false')
	})
})

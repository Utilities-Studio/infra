import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { exportGithubEnv, parseEnvContent, parseOutputKeys, resolveEnvFile } from './index'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'github-env-'))
	tempDirs.push(dir)
	return dir
}

describe('env file resolution', () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
	})

	test('resolves an environment-specific file when environment is passed', async () => {
		const envDir = resolve('/repo')
		const file = await resolveEnvFile({
			envDir,
			environment: 'production',
			exists: async (path) => path === join(envDir, '.env.production')
		})

		expect(file).toBe(join(envDir, '.env.production'))
	})

	test('falls back to the root env file when no environment is passed', async () => {
		const envDir = resolve('/repo')
		const file = await resolveEnvFile({
			envDir,
			exists: async (path) => path === join(envDir, '.env')
		})

		expect(file).toBe(join(envDir, '.env'))
	})

	test('uses an explicit env file relative to the env directory', async () => {
		const envDir = resolve('/repo')
		const file = await resolveEnvFile({
			envDir,
			envFile: 'config/smoke.env',
			exists: async (path) => path === join(envDir, 'config/smoke.env')
		})

		expect(file).toBe(join(envDir, 'config/smoke.env'))
	})
})

describe('env parsing and output selection', () => {
	test('parses dotenv content as data and strips dotenv metadata', () => {
		const env = parseEnvContent(`
DOTENV_PUBLIC_KEY=public_key
AWS_REGION=us-east-1
export AWS_ACCOUNT_ID="123456789012"
VITE_SITE_URL='https://example.com'
`)

		expect(env).toEqual({
			AWS_ACCOUNT_ID: '123456789012',
			AWS_REGION: 'us-east-1',
			VITE_SITE_URL: 'https://example.com'
		})
	})

	test('expands references from the same env file', () => {
		const env = parseEnvContent('API_HOST=example.com\nAPI_URL=https://${API_HOST}/v1\n')

		expect(env).toEqual({
			API_HOST: 'example.com',
			API_URL: 'https://example.com/v1'
		})
	})

	test('parses output keys without defaults', () => {
		expect(parseOutputKeys(null)).toEqual([])
		expect(parseOutputKeys('')).toEqual([])
		expect(parseOutputKeys(' AWS_REGION, VITE_SITE_URL ,, AWS_REGION ')).toEqual(['AWS_REGION', 'VITE_SITE_URL'])
	})
})

describe('GitHub Actions export', () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
	})

	test('writes every safe env key to GITHUB_ENV and only requested keys to GITHUB_OUTPUT', async () => {
		const dir = await makeTempDir()
		const githubEnv = join(dir, 'github-env.txt')
		const githubOutput = join(dir, 'github-output.txt')
		const commands: string[] = []

		await exportGithubEnv(
			{
				AWS_ACCOUNT_ID: '123456789012',
				AWS_REGION: 'us-east-1',
				VITE_MCP_URL: 'https://mcp.example.com'
			},
			{
				githubEnv,
				githubOutput,
				outputKeys: ['AWS_REGION', 'VITE_MCP_URL'],
				writeCommand: (command) => commands.push(command)
			}
		)

		expect(await readFile(githubEnv, 'utf8')).toBe(
			['AWS_ACCOUNT_ID=123456789012', 'AWS_REGION=us-east-1', 'VITE_MCP_URL=https://mcp.example.com', ''].join('\n')
		)
		expect(await readFile(githubOutput, 'utf8')).toBe(
			['aws_region=us-east-1', 'vite_mcp_url=https://mcp.example.com', ''].join('\n')
		)
		expect(commands).toContain('::add-mask::123456789012')
		expect(commands).toContain('::add-mask::us-east-1')
		expect(commands).toContain('::add-mask::https://mcp.example.com')
	})

	test('does not require GITHUB_OUTPUT when no output keys are passed', async () => {
		const dir = await makeTempDir()
		const githubEnv = join(dir, 'github-env.txt')

		await exportGithubEnv(
			{
				AWS_REGION: 'us-east-1'
			},
			{
				githubEnv,
				outputKeys: [],
				writeCommand: () => {}
			}
		)

		expect(await readFile(githubEnv, 'utf8')).toBe('AWS_REGION=us-east-1\n')
	})

	test('writes multiline values using GitHub environment file heredoc syntax', async () => {
		const dir = await makeTempDir()
		const githubEnv = join(dir, 'github-env.txt')

		await exportGithubEnv(
			{
				PRIVATE_KEY: 'line-one\nline-two'
			},
			{
				githubEnv,
				outputKeys: [],
				writeCommand: () => {}
			}
		)

		const content = await readFile(githubEnv, 'utf8')
		expect(content).toMatch(/^PRIVATE_KEY<<github_env_PRIVATE_KEY_[a-f0-9-]+\n/)
		expect(content).toContain('line-one\nline-two\n')
	})

	test('fails when a requested output key is missing', async () => {
		const dir = await makeTempDir()

		await expect(
			exportGithubEnv(
				{
					AWS_REGION: 'us-east-1'
				},
				{
					githubEnv: join(dir, 'github-env.txt'),
					githubOutput: join(dir, 'github-output.txt'),
					outputKeys: ['AWS_ACCOUNT_ID'],
					writeCommand: () => {}
				}
			)
		).rejects.toThrow('Requested output key not found: AWS_ACCOUNT_ID')
	})

	test('requires GITHUB_ENV before writing commands', async () => {
		const commands: string[] = []

		await expect(
			exportGithubEnv(
				{
					AWS_REGION: 'us-east-1'
				},
				{
					githubEnv: null,
					outputKeys: [],
					writeCommand: (command) => commands.push(command)
				}
			)
		).rejects.toThrow('GITHUB_ENV is not set')
		expect(commands).toEqual([])
	})

	test('requires GITHUB_OUTPUT when output keys are requested', async () => {
		const dir = await makeTempDir()
		const commands: string[] = []

		await expect(
			exportGithubEnv(
				{
					AWS_REGION: 'us-east-1'
				},
				{
					githubEnv: join(dir, 'github-env.txt'),
					githubOutput: null,
					outputKeys: ['AWS_REGION'],
					writeCommand: (command) => commands.push(command)
				}
			)
		).rejects.toThrow('GITHUB_OUTPUT is not set')
		expect(commands).toEqual([])
	})

	test('fails closed for GitHub-reserved env keys', async () => {
		const dir = await makeTempDir()

		await expect(
			exportGithubEnv(
				{
					AWS_REGION: 'us-east-1',
					GITHUB_TOKEN: 'token'
				},
				{
					githubEnv: join(dir, 'github-env.txt'),
					outputKeys: [],
					writeCommand: () => {}
				}
			)
		).rejects.toThrow('Cannot write GitHub-reserved env key: GITHUB_TOKEN')
	})

	test('exports values from an explicit non-dotenv file path', async () => {
		const dir = await makeTempDir()
		const source = join(dir, 'smoke-vars.txt')
		const githubEnv = join(dir, 'github-env.txt')
		const githubOutput = join(dir, 'github-output.txt')
		await writeFile(source, 'AWS_REGION=us-east-1\nAWS_ACCOUNT_ID=123456789012\n')

		const env = parseEnvContent(await readFile(source, 'utf8'))
		await exportGithubEnv(env, {
			githubEnv,
			githubOutput,
			outputKeys: ['AWS_ACCOUNT_ID'],
			writeCommand: () => {}
		})

		expect(await readFile(githubEnv, 'utf8')).toContain('AWS_REGION=us-east-1')
		expect(await readFile(githubOutput, 'utf8')).toBe('aws_account_id=123456789012\n')
	})
})

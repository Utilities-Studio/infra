import { describe, expect, test } from 'bun:test'

const sharedPath = '.github/workflows/npm-publish.yml'
const callerPath = '.github/workflows/release-package.yml'

describe('Lerna-Lite release workflow', () => {
	test('protects publishing with the default branch, environment, and repository concurrency', async () => {
		const workflow = await Bun.file(sharedPath).text()

		expect(workflow).toContain('workflow_call:')
		expect(workflow).not.toMatch(/workflow_dispatch:|\n  push:/)
		expect(workflow).toContain('environment: npm-publish')
		expect(workflow).toContain('CURRENT_REF: ${{ github.ref }}')
		expect(workflow).toContain('DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}')
		expect(workflow).toContain('npm publishing requires $EXPECTED_REF; received $CURRENT_REF')
		expect(workflow).toContain('needs: validate-ref')
		expect(workflow).toContain('    permissions: {}')
		expect(workflow).toContain('group: infra-npm-publish-${{ github.repository }}')
		expect(workflow).toContain('cancel-in-progress: false')
	})

	test('uses version-tagged hosted actions and the npm OIDC toolchain without an npm token', async () => {
		const workflow = await Bun.file(sharedPath).text()

		expect(workflow).toContain('runs-on: ubuntu-latest')
		expect(workflow).not.toContain('self-hosted')
		expect(workflow).not.toMatch(/uses: [^\n]+@[a-f0-9]{40}\b/)
		expect(workflow).toContain('uses: actions/checkout@v7')
		expect(workflow).toContain('uses: actions/setup-node@v7')
		expect(workflow).toContain('uses: oven-sh/setup-bun@v2')
		expect(workflow).not.toMatch(/octo-sts|release-token|create-github-app-token|\n\s+token:/)
		expect(workflow).toContain('node-version: "24.15.0"')
		expect(workflow).toContain('npm install --global npm@12.0.2 --ignore-scripts')
		expect(workflow).toContain('persist-credentials: true')
		expect(workflow).toContain('package-manager-cache: false')
		expect(workflow).toContain('NPM_CONFIG_PROVENANCE: "true"')
		expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|secrets\.|actions\/cache@/)
	})

	test('uses ready-made Lerna-Lite commands without Changesets or a custom generator', async () => {
		const workflow = await Bun.file(sharedPath).text()

		expect(workflow).not.toMatch(/changesets|run-func|pixpilot|npm-release-tools|git-auto-commit-action/i)
		expect(Array.from(new Bun.Glob('.changeset/**').scanSync({ cwd: '.', dot: true }))).toEqual([])
		for (const path of [
			'.github/actions/npm-release-changeset/action.yml',
			'.github/scripts/npm-release-changeset.ts',
		]) {
			expect(await Bun.file(path).exists()).toBe(false)
		}
		expect(workflow).toContain('uses: fregante/setup-git-user@v2')
		expect(workflow).toContain('PUBLISH_COMMAND: ${{ inputs.publish_command }}')
		expect(workflow).toContain('bash --noprofile --norc -e -u -o pipefail -c "$PUBLISH_COMMAND"')
	})

	test('verifies before version commits and always attempts to publish missing versions after successful versioning', async () => {
		const workflow = await Bun.file(sharedPath).text()
		const install = workflow.indexOf('- name: Install dependencies')
		const verify = workflow.indexOf('- name: Verify release')
		const identity = workflow.indexOf('- name: Setup release commit identity')
		const version = workflow.indexOf('- name: Version packages with Lerna-Lite')
		const release = workflow.indexOf('- name: Publish versioned packages')

		expect(install).toBeGreaterThan(-1)
		expect(verify).toBeGreaterThan(install)
		expect(identity).toBeGreaterThan(verify)
		expect(version).toBeGreaterThan(identity)
		expect(release).toBeGreaterThan(version)
		expect(workflow.slice(verify)).not.toContain('if:')
		expect(workflow).not.toContain('continue-on-error: true')
		expect(workflow).toContain('working-directory: ${{ inputs.working_directory }}')
		expect(workflow).toContain('default: "bun run release:version"')
		expect(workflow).toContain('default: "bun run release:publish"')
	})

	test('keeps caller shell commands static and rejects empty commands', async () => {
		const workflow = await Bun.file(sharedPath).text()

		for (const [variable, input] of [
			['INSTALL_COMMAND', 'install_command'],
			['VERIFY_COMMAND', 'verify_command'],
			['VERSION_COMMAND', 'version_command'],
			['PUBLISH_COMMAND', 'publish_command'],
		] as const) {
			expect(workflow).toContain(`${variable}: \${{ inputs.${input} }}`)
			expect(workflow).toContain(`${input} cannot be empty`)
		}
		for (const variable of ['INSTALL_COMMAND', 'VERIFY_COMMAND', 'VERSION_COMMAND', 'PUBLISH_COMMAND']) {
			expect(workflow).toContain(`bash --noprofile --norc -e -u -o pipefail -c "$${variable}"`)
		}
	})

	test('has one thin caller with commit, tag, and OIDC permissions and no custom release machinery', async () => {
		const caller = await Bun.file(callerPath).text()
		const shared = await Bun.file(sharedPath).text()

		expect(caller).toContain('branches: [main]')
		expect(caller).toContain('workflow_dispatch:')
		expect(caller).toContain('uses: ./.github/workflows/npm-publish.yml')
		expect(caller).toContain('contents: write')
		expect(shared).toContain('      contents: write')
		expect(shared).toContain('      id-token: write')
		expect(caller).not.toContain('pull-requests: write')
		expect(caller).toContain('id-token: write')
		expect(caller).not.toMatch(/matrix:|detect:|paths:|steps:|runs-on:|publish_command:/)
		expect(caller + shared).not.toMatch(/npm view|npm version|git diff|git tag |git push |git log |git config |git add |git commit |gh auth|RELEASE_VERSION|RELEASE_BASE|writeChangeset|getChangedPackagesSinceRef/)
		expect(await Bun.file('.github/workflows/publish-npm-trust.yml').exists()).toBe(false)
	})

	test('discovers every public package through one workspace and one lockfile', async () => {
		const root = await Bun.file('package.json').json()
		const config = await Bun.file('lerna.json').json()
		const packages = await Array.fromAsync(new Bun.Glob('packages/*/package.json').scan('.'))

		expect(root.private).toBe(true)
		expect(root.workspaces).toEqual(['packages/*'])
		expect(root.devDependencies['@changesets/cli']).toBeUndefined()
		for (const name of ['@lerna-lite/cli', '@lerna-lite/version', '@lerna-lite/publish']) {
			expect(root.devDependencies[name]).toBe('5.6.1')
		}
		expect(root.devDependencies['conventional-changelog-conventionalcommits']).toBe('10.4.0')
		expect(root.scripts.changeset).toBeUndefined()
		expect(root.scripts['release:version']).toBe('lerna version --yes')
		expect(root.scripts['release:publish']).toBe('lerna publish from-package --yes')
		expect(config.version).toBe('independent')
		expect(config.npmClient).toBe('bun')
		expect(config.npmClientArgs).toEqual(['--no-env-file'])
		expect(config.command.version).toMatchObject({
			allowBranch: 'main',
			conventionalCommits: true,
			changelogPreset: 'conventionalcommits',
			syncWorkspaceLock: true,
			message: 'chore(release): version packages [skip ci]',
		})
		expect(config.command.version.ignoreChanges).toEqual([
			'**/*.md', '**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/__fixtures__/**',
		])
		expect(packages).toHaveLength(7)
		expect(await Bun.file('bun.lock').exists()).toBe(true)
		for (const path of packages) {
			const pkg = await Bun.file(path).json()
			expect(pkg.private).not.toBe(true)
			expect(pkg.publishConfig.access).toBe('public')
			expect(await Bun.file(path.replace('package.json', 'bun.lock')).exists()).toBe(false)
		}
	})
})

import { describe, expect, test } from 'bun:test'

const sharedPath = '.github/workflows/npm-publish.yml'
const callerPath = '.github/workflows/release-package.yml'

describe('Changesets release workflow', () => {
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

	test('uses pinned hosted actions and the npm OIDC toolchain without an npm token', async () => {
		const workflow = await Bun.file(sharedPath).text()

		expect(workflow).toContain('runs-on: ubuntu-latest')
		expect(workflow).not.toContain('self-hosted')
		expect(workflow).not.toMatch(/uses: [^\n]+@v\d/)
		expect(workflow).toContain('node-version: "24.15.0"')
		expect(workflow).toContain('npm install --global npm@12.0.2 --ignore-scripts')
		expect(workflow).toContain('persist-credentials: false')
		expect(workflow).toContain('package-manager-cache: false')
		expect(workflow).toContain('NPM_CONFIG_PROVENANCE: "true"')
		expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|secrets\.|actions\/cache@/)
	})

	test('installs and verifies before handing versioning and publishing to Changesets v2', async () => {
		const workflow = await Bun.file(sharedPath).text()
		const install = workflow.indexOf('- name: Install dependencies')
		const verify = workflow.indexOf('- name: Verify release')
		const release = workflow.indexOf('- name: Create release PR or publish packages')

		expect(install).toBeGreaterThan(-1)
		expect(verify).toBeGreaterThan(install)
		expect(release).toBeGreaterThan(verify)
		expect(workflow).toContain('uses: changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51 # v2.1.2')
		expect(workflow).toContain('cwd: ${{ inputs.working_directory }}')
		expect(workflow).toContain('version-script: ${{ inputs.version_command }}')
		expect(workflow).toContain('publish-script: ${{ inputs.publish_command }}')
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
		for (const variable of ['INSTALL_COMMAND', 'VERIFY_COMMAND']) {
			expect(workflow).toContain(`bash --noprofile --norc -e -u -o pipefail -c "$${variable}"`)
		}
	})

	test('has one thin caller with PR, tag, and OIDC permissions and no custom release machinery', async () => {
		const caller = await Bun.file(callerPath).text()
		const shared = await Bun.file(sharedPath).text()

		expect(caller).toContain('branches: [main]')
		expect(caller).toContain('workflow_dispatch:')
		expect(caller).toContain('uses: ./.github/workflows/npm-publish.yml')
		expect(caller).toContain('contents: write')
		expect(caller).toContain('pull-requests: write')
		expect(caller).toContain('id-token: write')
		expect(caller).not.toMatch(/matrix:|detect:|paths:|steps:|runs-on:|publish_command:/)
		expect(caller + shared).not.toMatch(/npm view|npm version|git diff|git tag |git push |RELEASE_VERSION/)
		expect(await Bun.file('.github/workflows/publish-npm-trust.yml').exists()).toBe(false)
	})

	test('discovers every public package through one workspace and one lockfile', async () => {
		const root = await Bun.file('package.json').json()
		const config = await Bun.file('.changeset/config.json').json()
		const packages = await Array.fromAsync(new Bun.Glob('packages/*/package.json').scan('.'))

		expect(root.private).toBe(true)
		expect(root.workspaces).toEqual(['packages/*'])
		expect(root.devDependencies['@changesets/cli']).toBe('3.0.2')
		expect(root.scripts['release:version']).toBe('changeset version && bun --no-env-file install --lockfile-only --ignore-scripts')
		expect(root.scripts['release:publish']).toBe('changeset publish')
		expect(config.access).toBe('public')
		expect(config.ignore).toEqual([])
		expect(config.baseBranch).toBe('main')
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

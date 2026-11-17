import { describe, expect, test } from 'bun:test'

const workflows = [
	'.github/workflows/cloudflare-deploy.yml',
	'.github/workflows/cloudflare-pages-deploy.yml',
	'.github/workflows/cloudflare-pages-cleanup.yml',
	'.github/workflows/cloudflare-workers-cleanup.yml',
	'.github/workflows/supabase-deploy.yml',
]

describe('caller-selected runners', () => {
	test.each(workflows)('%s takes runs_on and defaults to ubuntu-latest', async (path) => {
		const workflow = Bun.YAML.parse(await Bun.file(path).text()) as {
			on: { workflow_call: { inputs: Record<string, { type: string; default: string }> } }
			jobs: Record<string, { 'runs-on': string }>
		}

		expect(workflow.on.workflow_call.inputs.runs_on).toMatchObject({ type: 'string', default: 'ubuntu-latest' })
		for (const job of Object.values(workflow.jobs)) {
			expect(job['runs-on']).toBe("${{ startsWith(inputs.runs_on, '[') && fromJSON(inputs.runs_on) || inputs.runs_on }}")
		}
	})
	test.each([
		['.github/workflows/cloudflare-deploy.yml', 5],
		['.github/workflows/cloudflare-pages-deploy.yml', 5],
		['.github/workflows/supabase-deploy.yml', 20],
	] as const)('%s takes timeout_minutes with the previous timeout as default', async (path, minutes) => {
		const workflow = Bun.YAML.parse(await Bun.file(path).text()) as {
			on: { workflow_call: { inputs: Record<string, { type: string; default: number }> } }
			jobs: Record<string, { 'timeout-minutes': string }>
		}

		expect(workflow.on.workflow_call.inputs.timeout_minutes).toMatchObject({ type: 'number', default: minutes })
		for (const job of Object.values(workflow.jobs)) {
			expect(job['timeout-minutes']).toBe('${{ inputs.timeout_minutes }}')
		}
	})
})

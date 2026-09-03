import { describe, expect, test } from "bun:test";

const workflowPaths = [
	".github/workflows/cloudflare-deploy.yml",
	".github/workflows/cloudflare-pages-deploy.yml",
	".github/workflows/supabase-deploy.yml",
] as const;

const inlineEnvWorkflows = [
	".github/workflows/cloudflare-pages-deploy.yml",
	".github/workflows/supabase-deploy.yml",
] as const;

async function readWorkflow(path: string): Promise<string> {
	return Bun.file(path).text();
}

describe("deploy workflow env loading", () => {
	for (const workflowPath of inlineEnvWorkflows) {
		test(`${workflowPath} materializes env files before detecting the env tier`, async () => {
			const workflow = await readWorkflow(workflowPath);

			expect(workflow).toContain(
				"uses: Utilities-Studio/infra/.github/actions/ensure-env-files@main",
			);
			expect(
				workflow.indexOf("uses: Utilities-Studio/infra/.github/actions/ensure-env-files@main"),
			).toBeGreaterThan(workflow.indexOf("run: bun ci"));
		});

		test(`${workflowPath} exports resolved dotenv keys with github-env`, async () => {
			const workflow = await readWorkflow(workflowPath);

			expect(workflow).toContain("bunx @utilities-studio/github-env@latest");
			expect(workflow).toContain('--env-file "${{ steps.env-file.outputs.path }}"');
			expect(workflow).toContain("--skip-reserved");
		});
	}

	for (const workflowPath of workflowPaths) {
		test(`${workflowPath} maps Infisical and dotenvx from vars/secrets into env`, async () => {
			const workflow = await readWorkflow(workflowPath);

			expect(workflow).not.toContain("infisical_identity_id");
			expect(workflow).not.toContain("infisical_project_slug");
			expect(workflow).not.toContain("infisical_domain");
			expect(workflow).toContain("INFISICAL_IDENTITY_ID: ${{ vars.INFISICAL_IDENTITY_ID }}");
			expect(workflow).toContain("INFISICAL_PROJECT_SLUG: ${{ vars.INFISICAL_PROJECT_SLUG }}");
			expect(workflow).toContain(
				"INFISICAL_DOMAIN: ${{ vars.INFISICAL_DOMAIN || 'https://app.infisical.com' }}",
			);
			expect(workflow).toContain(
				"DOTENV_PRIVATE_KEY_DEVELOPMENT: ${{ secrets.DOTENV_PRIVATE_KEY_DEVELOPMENT }}",
			);
		});
	}

	test("ensure-env-files prefers Infisical OIDC over dotenvx and reads env vars", async () => {
		const action = await readWorkflow(".github/actions/ensure-env-files/action.yml");

		expect(action).not.toContain("infisical_identity_id");
		expect(action).not.toContain("dotenv_private_key");
		expect(action).toContain("Infisical/secrets-action@v1.0.16");
		expect(action).toContain("method: oidc");
		expect(action).toContain("identity-id: ${{ env.INFISICAL_IDENTITY_ID }}");
		expect(action).toContain("project-slug: ${{ env.INFISICAL_PROJECT_SLUG }}");
		expect(action).toContain("export-type: file");
		expect(action).toContain("bunx --bun @dotenvx/dotenvx decrypt");
		expect(action).toContain('SECRET_PATH="${INFISICAL_SECRET_PATH:-/}"');
		expect(action).toContain('SLUG="${INFISICAL_ENV_SLUG:-${ENVIRONMENT:-production}}"');
		expect(action).toContain('FILE=".env"');
		expect(action.indexOf("source=infisical")).toBeLessThan(action.indexOf("source=dotenvx"));
	});

	test("cloudflare-deploy workflow delegates steps to the composite action", async () => {
		const workflow = await readWorkflow(".github/workflows/cloudflare-deploy.yml");

		expect(workflow).toContain(
			"uses: Utilities-Studio/infra/.github/actions/cloudflare-deploy@main",
		);
		expect(workflow).not.toContain("run: bun ci");
	});

	test("cloudflare-deploy composite materializes env files before detecting the env tier", async () => {
		const action = await readWorkflow(".github/actions/cloudflare-deploy/action.yml");

		expect(action).toContain(
			"uses: Utilities-Studio/infra/.github/actions/ensure-env-files@main",
		);
		expect(
			action.indexOf("uses: Utilities-Studio/infra/.github/actions/ensure-env-files@main"),
		).toBeGreaterThan(action.indexOf("run: bun ci"));
		expect(action).toContain("bunx @utilities-studio/github-env@latest");
		expect(action).toContain('--env-file "${{ steps.env-file.outputs.path }}"');
		expect(action.indexOf("ensure-cloudflare-worker@main")).toBeLessThan(
			action.indexOf("bunx @utilities-studio/sync-env@latest cloudflare"),
		);
		expect(action.indexOf("bunx @utilities-studio/sync-env@latest cloudflare")).toBeLessThan(
			action.indexOf("command: deploy"),
		);
	});

	test("cloudflare-pages-deploy checks the Pages project exists before deploy", async () => {
		const workflow = await readWorkflow(".github/workflows/cloudflare-pages-deploy.yml");

		expect(workflow.indexOf("ensure-cloudflare-pages@main")).toBeLessThan(
			workflow.indexOf("command: pages deploy"),
		);
	});

	test("supabase project config push can see VITE vars from the resolved env file", async () => {
		const workflow = await readWorkflow(".github/workflows/supabase-deploy.yml");

		expect(workflow).not.toContain("VITE_) ]] && continue");
		expect(workflow.indexOf("bunx @utilities-studio/github-env@latest")).toBeLessThan(
			workflow.indexOf("supabase config push --yes"),
		);
	});
});

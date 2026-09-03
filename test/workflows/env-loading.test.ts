import { describe, expect, test } from "bun:test";

const workflowPaths = [
  ".github/workflows/cloudflare-deploy.yml",
  ".github/workflows/cloudflare-pages-deploy.yml",
  ".github/workflows/supabase-deploy.yml",
];

async function readWorkflow(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("deploy workflow env loading", () => {
  for (const workflowPath of workflowPaths) {
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

  test("ensure-env-files prefers Infisical OIDC over dotenvx", async () => {
    const action = await readWorkflow(".github/actions/ensure-env-files/action.yml");

    expect(action).toContain("Infisical/secrets-action@v1.0.16");
    expect(action).toContain('method: oidc');
    expect(action).toContain("export-type: file");
    expect(action).toContain("bunx --bun @dotenvx/dotenvx decrypt");
    expect(action).toContain('SECRET_PATH="/$DIR"');
    expect(action).toContain('SLUG="${INFISICAL_ENV_SLUG:-${ENVIRONMENT:-production}}"');
    expect(action).toContain('FILE=".env"');
    expect(action.indexOf("source=infisical")).toBeLessThan(action.indexOf("source=dotenvx"));
  });

  test("cloudflare-deploy checks the Worker exists before sync-env", async () => {
    const workflow = await readWorkflow(".github/workflows/cloudflare-deploy.yml");

    expect(workflow.indexOf("ensure-cloudflare-worker@main")).toBeLessThan(
      workflow.indexOf("bunx @utilities-studio/sync-env@latest cloudflare"),
    );
    expect(workflow.indexOf("bunx @utilities-studio/sync-env@latest cloudflare")).toBeLessThan(
      workflow.indexOf("command: deploy"),
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

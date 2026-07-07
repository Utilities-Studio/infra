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
    test(`${workflowPath} exports resolved dotenv keys with github-env`, async () => {
      const workflow = await readWorkflow(workflowPath);

      expect(workflow).toContain("bunx @utilities-studio/github-env@latest");
      expect(workflow).toContain('--env-file "${{ steps.env-file.outputs.path }}"');
    });
  }

  test("supabase project config push can see VITE vars from the resolved env file", async () => {
    const workflow = await readWorkflow(".github/workflows/supabase-deploy.yml");

    expect(workflow).not.toContain("VITE_) ]] && continue");
    expect(workflow.indexOf("bunx @utilities-studio/github-env@latest")).toBeLessThan(
      workflow.indexOf("supabase config push --yes"),
    );
  });
});

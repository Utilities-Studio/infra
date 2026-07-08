import { describe, expect, test } from "bun:test";

const workflowPath = ".github/workflows/supabase-deploy.yml";

async function readWorkflow(): Promise<string> {
  return Bun.file(workflowPath).text();
}

describe("supabase-deploy workflow inputs", () => {
  test("does not emit empty string literals while evaluating the reusable workflow template", async () => {
    const workflow = await readWorkflow();

    const environmentInput = workflow.match(/environment:\n(?: {8}.+\n)+? {6}deploy_migrations:/);

    expect(workflow).not.toMatch(/\$\{\{[^}]*''[^}]*}}/);
    expect(environmentInput?.[0]).not.toContain('default: ""');
  });

  test("can skip pushing Supabase project config", async () => {
    const workflow = await readWorkflow();

    expect(workflow).toContain("skip_project_config_push:");
    expect(workflow).toContain('description: "Skip supabase config push"');
    expect(workflow).toContain("if: ${{ !inputs.skip_project_config_push }}");
    expect(workflow).toContain("run: supabase config push --yes");
  });
});

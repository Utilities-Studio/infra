import { describe, expect, test } from "bun:test";

const workflowPath = ".github/workflows/supabase-deploy.yml";

async function readWorkflow(): Promise<string> {
  return Bun.file(workflowPath).text();
}

describe("supabase-deploy workflow inputs", () => {
  test("can skip pushing Supabase project config", async () => {
    const workflow = await readWorkflow();

    expect(workflow).toContain("skip_project_config_push:");
    expect(workflow).toContain('description: "Skip supabase config push"');
    expect(workflow).toContain("if: ${{ !inputs.skip_project_config_push }}");
    expect(workflow).toContain("run: supabase config push --yes");
  });
});

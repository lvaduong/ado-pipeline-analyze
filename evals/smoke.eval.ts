import { defineEval } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description:
    "Agent calls get_run_summary for a fixture Azure Pipelines URL (eval fixtures, no live ADO).",
  async test(t) {
    await t.send(
      "Analyze this failed Azure Pipelines run and propose fixes: https://dev.azure.com/example/Mips/_build/results?buildId=1001",
    );
    t.succeeded();
    t.calledTool("get_run_summary");
  },
});

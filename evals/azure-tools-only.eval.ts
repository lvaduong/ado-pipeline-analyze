import { defineEval, includes } from "@grok/agent-sdk/evals";

const HOST_TOOLS = [
  "shell",
  "grep",
  "read",
  "glob",
  "ls",
  "edit",
  "delete",
  "write",
  "task",
] as const;

/**
 * Locks hillclimb round 2: pipeline RCA must not call host shell/fs tools.
 * Would fail under the pre-gate agent when a large list_failed_tests payload
 * spilled and the model opened it with shell (see hillclimb after-104954).
 * Round 4 still freezes this gate. `resolve_test_source` and
 * `rerun_local_spec` are authored server tools (allowed), not host shell.
 */
export default defineEval({
  tags: ["smoke", "azure-tools-only"],
  description:
    "Pipeline RCA: Azure tools + resolve_test_source + rerun_local_spec — no host shell/grep/read/fs tools.",
  async test(t) {
    await t.send(
      "Analyze this failed Azure Pipelines run and propose concrete fixes: https://dev.azure.com/example/Mips/_build/results?buildId=1001",
    );
    t.succeeded();
    t.calledTool("get_run_summary");
    t.calledTool("list_failed_tests");
    for (const name of HOST_TOOLS) {
      t.notCalledTool(name);
    }
    t.maxToolCalls(9);
    t.check(t.reply, includes(/Verdict/i));
    t.check(t.reply, includes(/9001|9002/));
  },
});

import { defineEval, includes } from "@grok/agent-sdk/evals";

/**
 * Locks hillclimb round 5: no duplicate Azure summary/list/log retries.
 * Would fail under round-4 traces that re-called get_run_summary (empty /
 * with project) or re-listed the same runId (see hillclimb-traces/round4
 * and eval azure-tools-only with get_run_summary×2).
 */
export default defineEval({
  tags: ["smoke", "tool-budget"],
  description:
    "Pipeline RCA stays within tool budget: one summary, ≤2 list_failed_tests, ≤3 get_log_slice, resolve once, ≤4 local spec re-runs; no host shell.",
  async test(t) {
    await t.send(
      "Analyze this failed Azure Pipelines run and propose concrete fixes: https://dev.azure.com/example/Mips/_build/results?buildId=1001",
    );
    t.succeeded();
    t.calledTool("get_run_summary", { count: 1 });
    t.calledTool("list_failed_tests", { count: (n) => n >= 1 && n <= 2 });
    t.calledTool("get_log_slice", { count: (n) => n >= 1 && n <= 3 });
    t.calledTool("resolve_test_source", { count: 1 });
    t.calledTool("rerun_local_spec", { count: (n) => n >= 1 && n <= 4 });
    t.notCalledTool("shell");
    t.notCalledTool("grep");
    t.notCalledTool("read");
    t.notCalledTool("edit");
    t.maxToolCalls(15);
    t.check(t.reply, includes(/Verdict/i));
    t.check(t.reply, includes(/9001|9002/));
    t.check(t.reply, includes(/Proposed fixes/i));
  },
});

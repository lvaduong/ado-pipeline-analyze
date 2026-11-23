import { defineEval, includes } from "@grok/agent-sdk/evals";

/**
 * Locks hillclimb round 1: reply must name a root-cause class label and
 * cite list_failed_tests result ids (eval fixture ids 9001/9002).
 * Would fail under the pre-round instructions that omitted id + class shape.
 */
export default defineEval({
  tags: ["smoke", "rca-shape"],
  description:
    "Pipeline RCA reply cites class label + test result ids from list_failed_tests.",
  async test(t) {
    await t.send(
      "Analyze this failed Azure Pipelines run and propose concrete fixes: https://dev.azure.com/example/Mips/_build/results?buildId=1001",
    );
    t.succeeded();
    t.calledTool("get_run_summary");
    t.calledTool("list_failed_tests");
    t.check(t.reply, includes(/Verdict/i));
    t.check(
      t.reply,
      includes(
        /`(ui-visibility|spa-auth-callback|hrgps-sync-contention|assertion-bug|env-config|flaky-infra|[a-z0-9-]+)`/,
      ),
    );
    t.check(t.reply, includes(/9001|9002/));
    t.check(t.reply, includes(/Proposed fixes/i));
  },
});

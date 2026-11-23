import { defineEval, includes } from "@grok/agent-sdk/evals";

/**
 * Locks hillclimb round 3: thin spa-auth / ui-visibility stacks must trigger
 * get_log_slice (would fail under round-2 instructions that only mentioned
 * the tool under Evidence gaps without calling it).
 */
export default defineEval({
  tags: ["smoke", "log-slice-when-thin"],
  description:
    "Thin auth/locator stacks → call get_log_slice at least once; Azure-only; RCA shape kept.",
  async test(t) {
    await t.send(
      "Analyze this failed Azure Pipelines run and propose concrete fixes: https://dev.azure.com/example/Mips/_build/results?buildId=1001",
    );
    t.succeeded();
    t.calledTool("get_run_summary");
    t.calledTool("list_failed_tests");
    t.calledTool("get_log_slice");
    t.notCalledTool("shell");
    t.notCalledTool("grep");
    t.notCalledTool("read");
    t.maxToolCalls(7);
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

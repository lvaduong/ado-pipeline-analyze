import { defineEval, includes } from "@grok/agent-sdk/evals";

/**
 * Locks hillclimb round 4: after list_failed_tests the agent must call
 * resolve_test_source (not host shell/grep) and cite repo-relative paths
 * in Proposed fixes. Would fail under round-3 instructions that only had
 * Azure tools and stack-string path guesses.
 */
export default defineEval({
  tags: ["smoke", "resolve-test-source"],
  description:
    "Failed tests → resolve_test_source; cite projects/mips paths; no host shell/fs.",
  async test(t) {
    await t.send(
      "Analyze this failed Azure Pipelines run and propose concrete fixes: https://dev.azure.com/example/Mips/_build/results?buildId=1001",
    );
    t.succeeded();
    t.calledTool("get_run_summary");
    t.calledTool("list_failed_tests");
    t.calledTool("resolve_test_source");
    t.notCalledTool("shell");
    t.notCalledTool("grep");
    t.notCalledTool("read");
    t.notCalledTool("glob");
    t.maxToolCalls(7);
    t.check(t.reply, includes(/Verdict/i));
    t.check(t.reply, includes(/9001|9002/));
    t.check(t.reply, includes(/Proposed fixes/i));
    t.check(
      t.reply,
      includes(
        /projects\/mips\/(?:tests\/ui\/notifications\/(?:new-position-request-updates|position-field-updates)\.spec\.ts|src\/pages\/requisition-details-page\.ts)/,
      ),
    );
  },
});

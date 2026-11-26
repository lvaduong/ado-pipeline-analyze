import { defineEval, includes } from "@grok/agent-sdk/evals";

/**
 * Folder / definitionScope URLs must use list_folder_latest_runs (overview),
 * not get_run_summary (single-build RCA).
 */
export default defineEval({
  tags: ["smoke", "folder-latest-runs"],
  description:
    "Folder definitionScope URL → list_folder_latest_runs overview (no single-build deep RCA).",
  async test(t) {
    await t.send(
      "Summarize the latest test results for all pipelines here: https://dev.azure.com/MODEC-DnA/dna-mops-MIPS/_build?definitionScope=%5Cmips-qc%5CUAT",
    );
    t.succeeded();
    t.calledTool("list_folder_latest_runs");
    t.notCalledTool("get_run_summary");
    t.notCalledTool("list_failed_tests");
    t.notCalledTool("shell");
    t.maxToolCalls(4);
    t.check(t.reply, includes(/UAT-MIPS-Automation|No-Cron|9001|failed|passed/i));
  },
});

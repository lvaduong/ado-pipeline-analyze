import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { applyAutomationFix } from "../lib/automation-edit.js";

export default defineTool({
  description:
    "Apply one exact text replacement in a MIPS automation .ts file (projects/mips/tests or projects/mips/src only). oldText must occur once. Use this only for an automation defect (wrong locator, stale assertion, page-object bug). Do not use it to make a test expect a product bug. After a successful apply, rerun that spec once with rerun_local_spec. This is not host shell or host edit.",
  execution: "server",
  effect: "write",
  dryRunResult: ({ path }) => ({
    ok: false as const,
    applied: false as const,
    path,
    error: "dry-run: automation file was not modified",
  }),
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .describe("Repo-relative .ts path under projects/mips/tests or projects/mips/src."),
    oldText: z
      .string()
      .min(8)
      .max(1500)
      .describe("Exact current text, unique in the file. Include enough lines to match once."),
    newText: z
      .string()
      .max(2000)
      .describe("Replacement text. Do not encode a product bug as the new expected value."),
  }),
  async execute({ path, oldText, newText }, ctx) {
    if (ctx.session.purpose === "eval") {
      return {
        ok: true as const,
        source: "eval-fixture" as const,
        applied: true as const,
        path,
        replacements: 1 as const,
        note: "eval: checkout file was not modified",
      };
    }
    const result = applyAutomationFix(path, oldText, newText);
    if (!result.ok) {
      return result;
    }
    return {
      ok: true as const,
      applied: true as const,
      path: result.path,
      replacements: result.replacements,
      hint: "Re-run this spec once with rerun_local_spec. Do not apply a second patch if that rerun still fails.",
    };
  },
});

import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { readAutomationSource } from "../lib/automation-edit.js";

export default defineTool({
  description:
    "Read one automation source file before editing it. Path must be a .ts file under projects/mips/tests or projects/mips/src in the dna-automation-test checkout. Returns a short numbered slice, not the whole repo. This is not host read/grep/shell. Call it on the failure frame file before apply_automation_fix.",
  execution: "server",
  effect: "read",
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .describe("Repo-relative .ts path under projects/mips/tests or projects/mips/src."),
    startLine: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("1-based line to start at. Use the failure frame line minus a few lines."),
    maxLines: z
      .number()
      .int()
      .positive()
      .max(120)
      .optional()
      .describe("Lines to return. Default 80, max 120."),
  }),
  async execute({ path, startLine, maxLines }, ctx) {
    if (ctx.session.purpose === "eval") {
      return {
        ok: true as const,
        source: "eval-fixture" as const,
        path,
        startLine: startLine ?? 40,
        endLine: startLine ?? 40,
        truncated: false,
        text: `${startLine ?? 40}|    await expect(page.getByRole("heading")).toBeVisible();`,
      };
    }
    return readAutomationSource(path, { startLine, maxLines });
  },
});

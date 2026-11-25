import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import {
  CHECKOUT_ROOT,
  RERUN_TIMEOUT_MS,
  normalizeSpecPath,
  runLocalSpec,
} from "../lib/rerun-local-spec.js";

const COMMAND =
  "ENV=uat npm run test -w projects/mips -- <spec path under projects/mips/tests>";

export default defineTool({
  description:
    "Re-run one hard-failed or flaky MIPS spec locally before the verdict. Fixed cwd " +
    `${CHECKOUT_ROOT}. The only command is \`${COMMAND}\`. Pass one spec path per failing theme. ` +
    "Returns exit code and Playwright counts (failed, flaky, passed), not the log. " +
    "If this tool is unavailable or the checkout is missing, stop and say so under Evidence gaps. Do not ask the user to paste a command.",
  execution: "server",
  effect: "write",
  dryRunResult: ({ specPath }) => ({
    ok: false as const,
    gap: "runner-missing" as const,
    error: "dry-run: local spec re-run was not executed",
    specPath,
  }),
  inputSchema: z.object({
    specPath: z
      .string()
      .min(1)
      .describe(
        "One repo-relative spec under projects/mips/tests, ending in .spec.ts. One theme per call. No extra CLI args.",
      ),
  }),
  async execute({ specPath }, ctx) {
    const normalized = normalizeSpecPath(specPath);
    if (!normalized.ok) {
      return {
        ok: false as const,
        error: normalized.error,
        specPath,
      };
    }

    if (ctx.session.purpose === "eval") {
      return {
        ok: true as const,
        source: "eval-fixture" as const,
        cwd: "/eval/dna-automation-test",
        command: `ENV=uat npm run test -w projects/mips -- ${normalized.specPath}`,
        specPath: normalized.specPath,
        exitCode: 1,
        timedOut: false,
        summary: { failed: 1, flaky: 0, passed: 0 },
        localResult: "local-reproduced" as const,
      };
    }

    const outcome = await runLocalSpec(normalized.specPath);
    if (!outcome.ok) {
      return {
        ok: false as const,
        gap: outcome.gap,
        error: outcome.error,
        cwd: CHECKOUT_ROOT,
        specPath: normalized.specPath,
      };
    }

    return {
      ok: true as const,
      cwd: CHECKOUT_ROOT,
      command: `ENV=uat npm run test -w projects/mips -- ${normalized.specPath}`,
      specPath: normalized.specPath,
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      timeoutMs: RERUN_TIMEOUT_MS,
      summary: outcome.summary,
      localResult: outcome.localResult,
      hint: outcome.timedOut
        ? "Runner hit the 15-minute timeout before a finished exit code. Say so under Evidence gaps. Do not label local-passed."
        : outcome.summary == null
          ? "Playwright summary lines were not found. Use exitCode for local-reproduced (non-zero) or local-passed (zero). Do not invent counts."
          : "Cite exitCode and summary counts. Put localResult on the Verdict line.",
    };
  },
});

import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import {
  EVAL_FIXTURE_RESOLVE,
  resolveCheckoutRoot,
  resolveQueries,
  type ResolveQuery,
} from "../lib/resolve-test-source.js";

const MAX_QUERIES = 12;

export default defineTool({
  description:
    "Map failed ADO test names / stacks to likely file paths under the local dna-automation-test checkout (read-only). Call after list_failed_tests with result ids + automatedTestName and/or stackTrace snippets. Prefer this over host shell/grep/read. Cite returned paths in Proposed fixes.",
  execution: "server",
  effect: "read",
  inputSchema: z.object({
    queries: z
      .array(
        z.object({
          resultId: z.number().int().positive().optional(),
          testName: z
            .string()
            .optional()
            .describe("automatedTestName or testCaseTitle from list_failed_tests."),
          stackTrace: z
            .string()
            .optional()
            .describe(
              "Optional stack/error snippet (path hints). Keep short — first ~1–2k chars of the stack is enough.",
            ),
        }),
      )
      .min(1)
      .max(MAX_QUERIES)
      .describe(
        `One entry per failed theme or result (max ${MAX_QUERIES}). Batch related titles; do not send one query per exclusive clone when they share the same stack file.`,
      ),
    checkoutRoot: z
      .string()
      .optional()
      .describe(
        "Override path to dna-automation-test. Default: DNA_AUTOMATION_TEST_ROOT or ~/Documents/dna-automation-test.",
      ),
  }),
  async execute({ queries, checkoutRoot }, ctx) {
    if (ctx.session.purpose === "eval") {
      return EVAL_FIXTURE_RESOLVE;
    }

    const rooted = resolveCheckoutRoot(checkoutRoot);
    if (!rooted.ok) {
      return {
        ok: false as const,
        error: "dna-automation-test checkout not found on this host.",
        tried: rooted.tried,
        hint: rooted.missingEnvHint,
      };
    }

    const limited = queries.slice(0, MAX_QUERIES).map(
      (q): ResolveQuery => ({
        resultId: q.resultId,
        testName: q.testName,
        stackTrace: q.stackTrace
          ? q.stackTrace.slice(0, 2500)
          : undefined,
      }),
    );

    const results = resolveQueries(rooted.root, limited);
    const matched = results.filter((r) => r.matches.length > 0).length;

    return {
      ok: true as const,
      source: "local-checkout" as const,
      checkoutRoot: rooted.root,
      checkoutSource: rooted.source,
      queryCount: limited.length,
      matchedCount: matched,
      results,
      hint:
        matched === 0
          ? "No paths found. Pass stackTrace path lines or a TC id in testName."
          : "Cite these repo-relative paths in Proposed fixes.",
    };
  },
});

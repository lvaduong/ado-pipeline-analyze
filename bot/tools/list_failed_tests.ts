import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import {
  adoFetchJson,
  compactStackTrace,
  EVAL_FIXTURE_FAILED_TESTS,
  MAX_ERROR_CHARS,
  MAX_FAILED_TESTS,
  missingSecretsResult,
  parseRunRef,
  readCreds,
} from "../lib/azure-devops.js";

type TestResult = {
  id: number;
  automatedTestName?: string;
  testCaseTitle?: string;
  outcome?: string;
  errorMessage?: string;
  stackTrace?: string;
  priority?: number;
  durationInMs?: number;
};

type ResultsPage = {
  value?: TestResult[];
  count?: number;
};

type TestRunsList = {
  value?: Array<{ id: number; failedTests?: number; name?: string }>;
};

export default defineTool({
  description:
    "List failed automated tests for one test run (name, error, stack). Call get_run_summary first, then once per distinct failing runId from summary.testRuns — do not re-call the same runId with/without project, and do not retry when capped:true (note the cap instead). Cap is small for token budget.",
  execution: "server",
  effect: "read",
  inputSchema: z.object({
    runUrlOrId: z
      .string()
      .min(1)
      .describe(
        "Build results URL, test run URL, or bare numeric build/run id (same as summary).",
      ),
    project: z
      .string()
      .optional()
      .describe(
        "Optional. Omit when the URL already names the project or summary already returned project.",
      ),
    orgUrl: z.string().optional(),
    runId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Test run id from get_run_summary.testRuns. Required when the build has multiple failing runs.",
      ),
    maxResults: z
      .number()
      .int()
      .positive()
      .max(MAX_FAILED_TESTS)
      .optional()
      .describe(`Max failed tests to return (default ${MAX_FAILED_TESTS}).`),
  }),
  async execute({ runUrlOrId, project, orgUrl, runId, maxResults }, ctx) {
    if (ctx.session.purpose === "eval") {
      return EVAL_FIXTURE_FAILED_TESTS;
    }

    const parsed = parseRunRef({ runUrlOrId, project, orgUrl });
    if ("error" in parsed) {
      return { ok: false as const, error: parsed.error };
    }

    const credsResult = readCreds();
    if (!credsResult.ok) {
      return missingSecretsResult(credsResult.missingSecrets);
    }

    const creds = {
      ...credsResult.creds,
      orgUrl: orgUrl?.trim()
        ? orgUrl.trim().replace(/\/+$/, "")
        : credsResult.creds.orgUrl,
    };

    const limit = Math.min(maxResults ?? MAX_FAILED_TESTS, MAX_FAILED_TESTS);
    let resolvedRunId = runId ?? parsed.runId;

    if (!resolvedRunId && parsed.buildId) {
      const buildUri = `vstfs:///Build/Build/${parsed.buildId}`;
      const runsPath = `${encodeURIComponent(parsed.project)}/_apis/test/runs?buildUri=${encodeURIComponent(buildUri)}&api-version=7.1`;
      const runsRes = await adoFetchJson<TestRunsList>(creds, runsPath);
      if (!runsRes.ok) return runsRes;
      const runs = runsRes.data.value ?? [];
      const withFails = runs.filter((r) => (r.failedTests ?? 0) > 0);
      const pick = withFails[0] ?? runs[0];
      if (!pick) {
        return {
          ok: true as const,
          source: "azure-devops" as const,
          buildId: parsed.buildId,
          runId: null,
          failedCount: 0,
          tests: [],
          hint: "No test runs linked to this build.",
        };
      }
      resolvedRunId = pick.id;
    }

    if (!resolvedRunId) {
      return {
        ok: false as const,
        error: "Could not resolve a test run id. Pass runId or a build URL.",
      };
    }

    const resultsPath =
      `${encodeURIComponent(parsed.project)}/_apis/test/Runs/${resolvedRunId}/results` +
      `?outcomes=Failed&$top=${limit}&api-version=7.1`;
    const resultsRes = await adoFetchJson<ResultsPage>(creds, resultsPath);
    if (!resultsRes.ok) return resultsRes;

    const tests = (resultsRes.data.value ?? []).map((t) => ({
      id: t.id,
      automatedTestName: t.automatedTestName ?? t.testCaseTitle,
      outcome: t.outcome,
      errorMessage: t.errorMessage
        ? t.errorMessage.slice(0, MAX_ERROR_CHARS)
        : undefined,
      stackTrace: compactStackTrace(t.stackTrace),
      durationInMs: t.durationInMs,
    }));

    return {
      ok: true as const,
      source: "azure-devops" as const,
      project: parsed.project,
      buildId: parsed.buildId,
      runId: resolvedRunId,
      failedCount: tests.length,
      capped: tests.length >= limit,
      tests,
    };
  },
});

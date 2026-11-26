import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import {
  adoFetchJson,
  EVAL_FIXTURE_SUMMARY,
  missingSecretsResult,
  parseRunRef,
  readCreds,
} from "../lib/azure-devops.js";
import {
  loadPinnedFixture,
  missingPinnedFixture,
  resolvePinnedBuildId,
} from "../lib/pinned-fixtures.js";

type Build = {
  id: number;
  buildNumber?: string;
  status?: string;
  result?: string;
  sourceBranch?: string;
  definition?: { name?: string };
  project?: { name?: string };
  _links?: { web?: { href?: string } };
};

type TestRunsList = {
  value?: Array<{
    id: number;
    name?: string;
    totalTests?: number;
    passedTests?: number;
    failedTests?: number;
    state?: string;
  }>;
};

export default defineTool({
  description:
    "Fetch an Azure Pipelines build / test-run summary (result, branch, definition, linked test runs). Call exactly once first with a single build/test-run URL or bare numeric id as runUrlOrId — never empty. Do NOT pass a pipeline folder path (e.g. \\mips-qc\\UAT) or a _build?definitionScope=… URL here — use list_folder_latest_runs for those. Do not retry with project/orgUrl after ok:true; use returned testRuns[].id for list_failed_tests. Needs AZURE_DEVOPS_ORG_URL + AZURE_DEVOPS_PAT, or returns a missing-secrets hint so you can use pasted logs instead.",
  execution: "server",
  effect: "read",
  inputSchema: z.object({
    runUrlOrId: z
      .string()
      .min(1)
      .describe(
        "Required. Build results URL, test run URL, or bare numeric build id from the user message.",
      ),
    project: z
      .string()
      .optional()
      .describe(
        "Only when runUrlOrId is a bare id and the project is not in the URL. Skip if the URL already includes the project.",
      ),
    orgUrl: z
      .string()
      .optional()
      .describe("Override org URL (defaults to AZURE_DEVOPS_ORG_URL). Rarely needed."),
  }),
  async execute({ runUrlOrId, project, orgUrl }, ctx) {
    if (ctx.session.purpose === "eval") {
      return EVAL_FIXTURE_SUMMARY;
    }

    const parsed = parseRunRef({ runUrlOrId, project, orgUrl });
    if ("error" in parsed) {
      return { ok: false as const, error: parsed.error };
    }

    const pinnedId = resolvePinnedBuildId(parsed.buildId);
    if (pinnedId != null) {
      const fixture = loadPinnedFixture(pinnedId, "get_run_summary");
      return fixture ?? missingPinnedFixture(pinnedId, "get_run_summary");
    }

    const credsResult = readCreds();
    if (!credsResult.ok) {
      return missingSecretsResult(credsResult.missingSecrets);
    }

    // Prefer env org when set; parsed URL may still name project/ids.
    const creds = {
      ...credsResult.creds,
      orgUrl: orgUrl?.trim()
        ? orgUrl.trim().replace(/\/+$/, "")
        : credsResult.creds.orgUrl,
    };

    if (!parsed.buildId && parsed.runId) {
      const runPath = `${encodeURIComponent(parsed.project)}/_apis/test/Runs/${parsed.runId}?api-version=7.1`;
      const runRes = await adoFetchJson<{
        id: number;
        name?: string;
        totalTests?: number;
        passedTests?: number;
        failedTests?: number;
        state?: string;
        build?: { id?: string };
      }>(creds, runPath);
      if (!runRes.ok) return runRes;
      return {
        ok: true as const,
        source: "azure-devops" as const,
        project: parsed.project,
        runId: runRes.data.id,
        name: runRes.data.name,
        state: runRes.data.state,
        totalTests: runRes.data.totalTests,
        passedTests: runRes.data.passedTests,
        failedTests: runRes.data.failedTests,
        buildId: runRes.data.build?.id
          ? Number(runRes.data.build.id)
          : undefined,
      };
    }

    const buildId = parsed.buildId!;
    const buildPath = `${encodeURIComponent(parsed.project)}/_apis/build/builds/${buildId}?api-version=7.1`;
    const buildRes = await adoFetchJson<Build>(creds, buildPath);
    if (!buildRes.ok) return buildRes;

    const buildUri = `vstfs:///Build/Build/${buildId}`;
    const runsPath = `${encodeURIComponent(parsed.project)}/_apis/test/runs?buildUri=${encodeURIComponent(buildUri)}&api-version=7.1`;
    const runsRes = await adoFetchJson<TestRunsList>(creds, runsPath);

    const testRuns =
      runsRes.ok && Array.isArray(runsRes.data.value)
        ? runsRes.data.value.map((r) => ({
            id: r.id,
            name: r.name,
            totalTests: r.totalTests,
            passedTests: r.passedTests,
            failedTests: r.failedTests,
            state: r.state,
          }))
        : [];

    return {
      ok: true as const,
      source: "azure-devops" as const,
      project: parsed.project,
      buildId: buildRes.data.id,
      buildNumber: buildRes.data.buildNumber,
      result: buildRes.data.result,
      status: buildRes.data.status,
      sourceBranch: buildRes.data.sourceBranch,
      definitionName: buildRes.data.definition?.name,
      webUrl: buildRes.data._links?.web?.href,
      testRuns,
      testRunsError: runsRes.ok ? undefined : runsRes.error,
    };
  },
});

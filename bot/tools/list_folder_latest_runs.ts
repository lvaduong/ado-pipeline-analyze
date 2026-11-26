import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import {
  EVAL_FIXTURE_FOLDER_LATEST,
  MAX_FOLDER_DEFINITIONS,
  MAX_FOLDER_FAILED_SAMPLE,
  missingSecretsResult,
  parseFolderRef,
  readCreds,
} from "../lib/azure-devops.js";
import { listFolderLatestRuns } from "../lib/folder-latest-runs.js";

export default defineTool({
  description:
    "Summarize the latest completed build + test counts for every pipeline under an Azure DevOps definition folder (e.g. \\mips-qc\\UAT or a _build?definitionScope=… URL). Call this first when the user pastes a folder/definitionScope link or asks for all pipelines in a folder. Returns compact per-pipeline totals and a short failed-test name sample — not full stacks. For deep RCA on one failed build, follow with get_run_summary + list_failed_tests.",
  execution: "server",
  effect: "read",
  inputSchema: z.object({
    folderPathOrUrl: z
      .string()
      .min(1)
      .describe(
        "Required. Folder path like \\mips-qc\\UAT, or a builds UI URL with definitionScope (e.g. https://dev.azure.com/ORG/PROJECT/_build?definitionScope=%5Cmips-qc%5CUAT).",
      ),
    project: z
      .string()
      .optional()
      .describe(
        "Only when folderPathOrUrl is a bare path and the project is not in a URL. Example: dna-mops-MIPS.",
      ),
    orgUrl: z
      .string()
      .optional()
      .describe("Override org URL (defaults to AZURE_DEVOPS_ORG_URL). Rarely needed."),
    maxDefinitions: z
      .number()
      .int()
      .positive()
      .max(MAX_FOLDER_DEFINITIONS)
      .optional()
      .describe(
        `Max pipelines to include (default ${MAX_FOLDER_DEFINITIONS}).`,
      ),
    includeFailedSample: z
      .boolean()
      .optional()
      .describe(
        "Include up to maxFailedSample failing test names per failed/partial pipeline (default true).",
      ),
    maxFailedSample: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_FOLDER_FAILED_SAMPLE)
      .optional()
      .describe(
        `Max failing test names per pipeline (default ${MAX_FOLDER_FAILED_SAMPLE}).`,
      ),
  }),
  async execute(
    {
      folderPathOrUrl,
      project,
      orgUrl,
      maxDefinitions,
      includeFailedSample,
      maxFailedSample,
    },
    ctx,
  ) {
    if (ctx.session.purpose === "eval") {
      return EVAL_FIXTURE_FOLDER_LATEST;
    }

    const parsed = parseFolderRef({ folderPathOrUrl, project, orgUrl });
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

    return listFolderLatestRuns(creds, parsed, {
      maxDefinitions,
      includeFailedSample,
      maxFailedSample,
    });
  },
});

import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import {
  adoFetchJson,
  adoFetchText,
  DEFAULT_LOG_CHARS,
  EVAL_FIXTURE_LOG_LIST,
  EVAL_FIXTURE_LOG_SLICE,
  MAX_LOG_CHARS,
  missingSecretsResult,
  parseRunRef,
  readCreds,
  sliceText,
} from "../lib/azure-devops.js";

type LogsList = {
  count?: number;
  value?: Array<{ id: number; lineCount?: number; type?: string }>;
};

export default defineTool({
  description:
    "Fetch a character-bounded slice of an Azure Pipelines build log. Call when list_failed_tests stacks are thin/truncated or auth-vs-locator ambiguous (spa-auth-callback / ui-visibility); skip when stacks already show rich HRGPS/assertion evidence (e.g. IGNORED Celery + file:line). Budget: omit logId once to list, then one end slice of the parallel/UI job; at most one other logId if the first slice is exclusive HRGPS noise (≤3 calls total). No multi-offset probes. Keep maxChars low.",
  execution: "server",
  effect: "read",
  inputSchema: z.object({
    runUrlOrId: z
      .string()
      .describe("Build results URL or bare numeric build id."),
    project: z.string().optional(),
    orgUrl: z.string().optional(),
    logId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Build log id. If omitted, returns the log list so you can pick one.",
      ),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Character offset into the log text (default 0)."),
    maxChars: z
      .number()
      .int()
      .positive()
      .max(MAX_LOG_CHARS)
      .optional()
      .describe(
        `Max characters to return (default ${DEFAULT_LOG_CHARS}, max ${MAX_LOG_CHARS}).`,
      ),
  }),
  async execute(
    { runUrlOrId, project, orgUrl, logId, offset, maxChars },
    ctx,
  ) {
    if (ctx.session.purpose === "eval") {
      if (!logId) return EVAL_FIXTURE_LOG_LIST;
      return EVAL_FIXTURE_LOG_SLICE;
    }

    const parsed = parseRunRef({ runUrlOrId, project, orgUrl });
    if ("error" in parsed) {
      return { ok: false as const, error: parsed.error };
    }
    if (!parsed.buildId) {
      return {
        ok: false as const,
        error:
          "get_log_slice needs a buildId. Pass a build results URL or bare build id.",
      };
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

    const projectEnc = encodeURIComponent(parsed.project);
    const buildId = parsed.buildId;

    if (!logId) {
      const listPath = `${projectEnc}/_apis/build/builds/${buildId}/logs?api-version=7.1`;
      const listRes = await adoFetchJson<LogsList>(creds, listPath);
      if (!listRes.ok) return listRes;
      return {
        ok: true as const,
        source: "azure-devops" as const,
        buildId,
        logs: (listRes.data.value ?? []).map((l) => ({
          id: l.id,
          lineCount: l.lineCount,
          type: l.type,
        })),
        hint: "Pick a logId and call get_log_slice again.",
      };
    }

    const logPath = `${projectEnc}/_apis/build/builds/${buildId}/logs/${logId}?api-version=7.1`;
    const textRes = await adoFetchText(creds, logPath);
    if (!textRes.ok) return textRes;

    const sliced = sliceText(textRes.text, { offset, maxChars });
    return {
      ok: true as const,
      source: "azure-devops" as const,
      buildId,
      logId,
      offset: sliced.offset,
      truncated: sliced.truncated,
      totalChars: sliced.totalChars,
      text: sliced.text,
    };
  },
});

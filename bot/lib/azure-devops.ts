/**
 * Azure DevOps REST helpers for pipeline / test evidence.
 * Credentials come only from process.env. Never log or return the PAT.
 */

export type AzureCreds = {
  orgUrl: string;
  pat: string;
};

export type ParsedRunRef = {
  orgUrl: string;
  project: string;
  buildId?: number;
  runId?: number;
  raw: string;
};

export type ParsedFolderRef = {
  orgUrl: string;
  project: string;
  /** ADO folder path, e.g. `\mips-qc\UAT` (leading backslash). */
  folderPath: string;
  raw: string;
};

/** Max pipelines returned by list_folder_latest_runs (token budget). */
export const MAX_FOLDER_DEFINITIONS = 20;
/** Max failing test names sampled per pipeline in a folder summary. */
export const MAX_FOLDER_FAILED_SAMPLE = 5;

export type ToolResultOk<T extends Record<string, unknown>> = T & {
  ok: true;
};

export type ToolResultErr = {
  ok: false;
  error: string;
  hint?: string;
  missingSecrets?: string[];
};

const ENV_ORG = "AZURE_DEVOPS_ORG_URL";
const ENV_PAT = "AZURE_DEVOPS_PAT";

/** Hard caps so tools stay token-light and stay inline (no host spill/shell). */
export const MAX_FAILED_TESTS = 40;
export const MAX_ERROR_CHARS = 600;
export const MAX_STACK_CHARS = 900;
export const MAX_LOG_CHARS = 12_000;
export const DEFAULT_LOG_CHARS = 4_000;

/** Keep the assert + first stack frames; drop Playwright attachment noise. */
export function compactStackTrace(
  stackTrace: string | undefined,
  maxChars = MAX_STACK_CHARS,
): string | undefined {
  if (!stackTrace) return undefined;
  const lines = stackTrace.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (
      lower.startsWith("attachment #") ||
      lower.startsWith("error context:") ||
      lower.includes("────────") ||
      lower.startsWith("usage:") ||
      lower.startsWith("npx playwright") ||
      lower.startsWith("correlation id:") ||
      lower.startsWith("use this to search logs:") ||
      lower.startsWith("grep \"") ||
      /^(\.\.\/)?test-results\//.test(trimmed)
    ) {
      continue;
    }
    kept.push(trimmed);
    if (kept.join("\n").length >= maxChars) break;
  }
  const text = kept.join("\n").slice(0, maxChars);
  return text || stackTrace.slice(0, maxChars);
}

export function readCreds():
  | { ok: true; creds: AzureCreds }
  | { ok: false; missingSecrets: string[] } {
  const orgUrl = (process.env[ENV_ORG] ?? "").trim().replace(/\/+$/, "");
  const pat = (process.env[ENV_PAT] ?? "").trim();
  const missing: string[] = [];
  if (!orgUrl) missing.push(ENV_ORG);
  if (!pat) missing.push(ENV_PAT);
  if (missing.length > 0) {
    return { ok: false, missingSecrets: missing };
  }
  return { ok: true, creds: { orgUrl, pat } };
}

/**
 * Normalize an ADO pipeline folder path to `\a\b` form.
 * Accepts `\mips-qc\UAT`, `/mips-qc/UAT`, `mips-qc/UAT`, URL-encoded scopes.
 */
export function normalizeFolderPath(rawPath: string): string | { error: string } {
  let p = rawPath.trim();
  if (!p) return { error: "folder path is empty" };
  try {
    p = decodeURIComponent(p);
  } catch {
    // keep raw
  }
  p = p.replace(/\//g, "\\");
  if (!p.startsWith("\\")) p = `\\${p}`;
  p = p.replace(/\\+/g, "\\");
  if (p === "\\") return { error: "folder path is empty" };
  return p;
}

/**
 * Parse a pipeline-folder URL or bare folder path.
 * Accepts:
 * - `\mips-qc\UAT` / `/mips-qc/UAT` (needs project via arg or env default)
 * - https://dev.azure.com/{org}/{project}/_build?definitionScope=%5Cmips-qc%5CUAT
 * - same on *.visualstudio.com
 */
export function parseFolderRef(input: {
  folderPathOrUrl: string;
  project?: string;
  orgUrl?: string;
}): ParsedFolderRef | { error: string } {
  const raw = input.folderPathOrUrl.trim();
  if (!raw) return { error: "folderPathOrUrl is empty" };

  const envOrg = (process.env[ENV_ORG] ?? "").trim().replace(/\/+$/, "");
  const overrideOrg = input.orgUrl?.trim().replace(/\/+$/, "") || undefined;
  const overrideProject = input.project?.trim() || undefined;

  // Bare folder path (no scheme)
  if (!/^https?:\/\//i.test(raw)) {
    const folderPath = normalizeFolderPath(raw);
    if (typeof folderPath !== "string") return folderPath;
    const orgUrl = overrideOrg ?? envOrg;
    const project = overrideProject ?? "";
    if (!orgUrl) {
      return {
        error:
          "Bare folder path needs org URL. Set AZURE_DEVOPS_ORG_URL or pass orgUrl.",
      };
    }
    if (!project) {
      return {
        error:
          "Bare folder path needs project. Pass project (e.g. dna-mops-MIPS).",
      };
    }
    return { orgUrl, project, folderPath, raw };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: `Not a URL or folder path: ${raw.slice(0, 80)}` };
  }

  const host = url.hostname.toLowerCase();
  let orgUrl = "";
  let project = "";

  if (host === "dev.azure.com" || host.endsWith(".dev.azure.com")) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return { error: "URL missing org/project path segments" };
    }
    orgUrl = `${url.protocol}//${url.host}/${parts[0]}`;
    project = decodeURIComponent(parts[1] ?? "");
  } else if (host.endsWith(".visualstudio.com")) {
    const org = host.split(".")[0] ?? "";
    orgUrl = `${url.protocol}//${host}`;
    const parts = url.pathname.split("/").filter(Boolean);
    const start = parts[0]?.toLowerCase() === "defaultcollection" ? 1 : 0;
    project = decodeURIComponent(parts[start] ?? "");
    if (!org || !project) {
      return { error: "visualstudio.com URL missing org or project" };
    }
  } else {
    return { error: `Unrecognized Azure DevOps host: ${host}` };
  }

  if (overrideOrg) orgUrl = overrideOrg;
  if (overrideProject) project = overrideProject;

  const scope =
    url.searchParams.get("definitionScope") ??
    url.searchParams.get("path") ??
    "";
  if (!scope) {
    return {
      error:
        "URL has no definitionScope (or path) query. Paste a _build?definitionScope=… URL or a bare folder path like \\mips-qc\\UAT.",
    };
  }
  const folderPath = normalizeFolderPath(scope);
  if (typeof folderPath !== "string") return folderPath;

  return { orgUrl, project, folderPath, raw };
}

/**
 * Parse a pasted Azure DevOps build/test URL or a bare build/run id.
 * Accepts:
 * - https://dev.azure.com/{org}/{project}/_build/results?buildId=123
 * - https://dev.azure.com/{org}/{project}/_testManagement/runs?runId=456
 * - https://{org}.visualstudio.com/{project}/_build/results?buildId=123
 * - bare digits (treated as buildId; project must be supplied separately)
 */
export function parseRunRef(input: {
  runUrlOrId: string;
  project?: string;
  orgUrl?: string;
}): ParsedRunRef | { error: string } {
  const raw = input.runUrlOrId.trim();
  if (!raw) return { error: "runUrlOrId is empty" };

  if (/^\d+$/.test(raw)) {
    const orgUrl = (input.orgUrl ?? process.env[ENV_ORG] ?? "")
      .trim()
      .replace(/\/+$/, "");
    const project = (input.project ?? "").trim();
    if (!orgUrl) {
      return {
        error:
          "Bare build id needs org URL. Set AZURE_DEVOPS_ORG_URL or pass orgUrl.",
      };
    }
    if (!project) {
      return { error: "Bare build id needs project. Pass project." };
    }
    return {
      orgUrl,
      project,
      buildId: Number(raw),
      raw,
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: `Not a URL or bare numeric id: ${raw.slice(0, 80)}` };
  }

  const host = url.hostname.toLowerCase();
  let orgUrl = "";
  let project = "";

  if (host === "dev.azure.com" || host.endsWith(".dev.azure.com")) {
    const parts = url.pathname.split("/").filter(Boolean);
    // /{org}/{project}/...
    if (parts.length < 2) {
      return { error: "URL missing org/project path segments" };
    }
    orgUrl = `${url.protocol}//${url.host}/${parts[0]}`;
    project = decodeURIComponent(parts[1] ?? "");
  } else if (host.endsWith(".visualstudio.com")) {
    const org = host.split(".")[0] ?? "";
    orgUrl = `${url.protocol}//${host}`;
    const parts = url.pathname.split("/").filter(Boolean);
    // optional DefaultCollection
    const start = parts[0]?.toLowerCase() === "defaultcollection" ? 1 : 0;
    project = decodeURIComponent(parts[start] ?? "");
    if (!org || !project) {
      return { error: "visualstudio.com URL missing org or project" };
    }
  } else {
    return { error: `Unrecognized Azure DevOps host: ${host}` };
  }

  if (input.orgUrl?.trim()) {
    orgUrl = input.orgUrl.trim().replace(/\/+$/, "");
  }
  if (input.project?.trim()) {
    project = input.project.trim();
  }

  const buildIdRaw =
    url.searchParams.get("buildId") ?? url.searchParams.get("buildid");
  const runIdRaw =
    url.searchParams.get("runId") ?? url.searchParams.get("runid");

  const buildId = buildIdRaw ? Number(buildIdRaw) : undefined;
  const runId = runIdRaw ? Number(runIdRaw) : undefined;

  if (
    (buildId === undefined || Number.isNaN(buildId)) &&
    (runId === undefined || Number.isNaN(runId))
  ) {
    return {
      error:
        "URL has no buildId or runId query param. Paste the build results URL or a numeric id.",
    };
  }

  return {
    orgUrl,
    project,
    buildId:
      buildId !== undefined && !Number.isNaN(buildId) ? buildId : undefined,
    runId: runId !== undefined && !Number.isNaN(runId) ? runId : undefined,
    raw,
  };
}

function authHeader(pat: string): string {
  // Azure DevOps: Basic auth with empty username and PAT as password.
  const token = Buffer.from(`:${pat}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export async function adoFetchJson<T>(
  creds: AzureCreds,
  pathAndQuery: string,
): Promise<{ ok: true; data: T } | ToolResultErr> {
  const url = pathAndQuery.startsWith("http")
    ? pathAndQuery
    : `${creds.orgUrl.replace(/\/+$/, "")}/${pathAndQuery.replace(/^\//, "")}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: authHeader(creds.pat),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "network error";
    return {
      ok: false,
      error: `Azure DevOps request failed: ${message}`,
      hint: "Check network egress and AZURE_DEVOPS_ORG_URL.",
    };
  }

  if (!res.ok) {
    // Never include response body if it might echo auth; keep status only.
    return {
      ok: false,
      error: `Azure DevOps HTTP ${res.status}`,
      hint:
        res.status === 401 || res.status === 403
          ? "PAT may be missing scopes (Build Read, Test Results Read) or expired."
          : "Check org URL, project name, and id.",
    };
  }

  try {
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Azure DevOps returned non-JSON body" };
  }
}

export async function adoFetchText(
  creds: AzureCreds,
  pathAndQuery: string,
): Promise<{ ok: true; text: string } | ToolResultErr> {
  const url = pathAndQuery.startsWith("http")
    ? pathAndQuery
    : `${creds.orgUrl.replace(/\/+$/, "")}/${pathAndQuery.replace(/^\//, "")}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/plain",
        Authorization: authHeader(creds.pat),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "network error";
    return {
      ok: false,
      error: `Azure DevOps log request failed: ${message}`,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `Azure DevOps HTTP ${res.status} fetching log`,
      hint:
        res.status === 401 || res.status === 403
          ? "PAT may lack Build Read scope."
          : "Check buildId / logId.",
    };
  }

  const text = await res.text();
  return { ok: true, text };
}

export function missingSecretsResult(
  missingSecrets: string[],
): ToolResultErr {
  return {
    ok: false,
    error: "Azure DevOps credentials are not configured on this host.",
    missingSecrets,
    hint:
      "Set AZURE_DEVOPS_ORG_URL and AZURE_DEVOPS_PAT as env secrets (never paste the PAT in chat). Or paste a run URL plus log snippets and analyze those without calling Azure.",
  };
}

export function sliceText(
  text: string,
  opts: { offset?: number; maxChars?: number },
): { text: string; offset: number; truncated: boolean; totalChars: number } {
  const totalChars = text.length;
  const offset = Math.max(0, opts.offset ?? 0);
  const maxChars = Math.min(
    MAX_LOG_CHARS,
    Math.max(1, opts.maxChars ?? DEFAULT_LOG_CHARS),
  );
  const slice = text.slice(offset, offset + maxChars);
  return {
    text: slice,
    offset,
    truncated: offset + slice.length < totalChars,
    totalChars,
  };
}

/** Fixture payload used when session.purpose === "eval". */
export const EVAL_FIXTURE_SUMMARY = {
  ok: true as const,
  source: "eval-fixture" as const,
  project: "Mips",
  buildId: 1001,
  buildNumber: "20261123.1",
  result: "failed",
  status: "completed",
  sourceBranch: "refs/heads/main",
  definitionName: "mips-automation-tests",
  testRuns: [
    {
      id: 5001,
      name: "Automation",
      totalTests: 12,
      passedTests: 10,
      failedTests: 2,
      state: "Completed",
    },
  ],
};

/**
 * Thin Playwright stacks (auth + locator) — tempt shell if allowlisted, and
 * require get_log_slice under the round-3 call rule (ids stay 9001/9002).
 */
const EVAL_STACK_AUTH_THIN = [
  "Error: expect(locator).toBeVisible() failed",
  "Locator: getByRole('heading', { name: '[TC 9001] New position update', exact: true })",
  "Timeout: 10000ms",
  "Error: element(s) not found",
  "Call log:",
  '  - waiting for getByRole(\'heading\', { name: \'[TC 9001] New position update\' })',
  "    - waiting for\" https://login.microsoftonline.com/73d27a24-8a3e-417d-b34c-b2dc4ba5c26f/oauth2/v2.0/authorize?client_id=6cdd110e",
  "attachment #1: screenshot (image/png) " + "─".repeat(80),
  "../test-results/no-cron-parallel/example/test-failed-1.png",
  "Use this to search logs:",
  'grep "corr-eval-9001" logs/*.log',
  "attachment #2: video (video/webm) " + "─".repeat(80),
  "npx playwright show-trace ../test-results/example/trace.zip",
  "x".repeat(2500),
].join("\n");

const EVAL_STACK_LOCATOR_THIN = [
  "Error: expect(locator).toBeVisible() failed",
  "Locator: getByRole('row', { name: /Forecast/i }).getByRole('gridcell', { name: /0[.,]60/ }).first().getByRole('spinbutton').first()",
  "Timeout: 10000ms",
  "Error: element(s) not found",
  "at ../src/pages/requisition-details-page.ts:418",
  "attachment #1: screenshot (image/png) " + "─".repeat(40),
  "x".repeat(1200),
].join("\n");

export const EVAL_FIXTURE_FAILED_TESTS = {
  ok: true as const,
  source: "eval-fixture" as const,
  runId: 5001,
  failedCount: 2,
  tests: [
    {
      id: 9001,
      automatedTestName:
        "E2E - New position request updates › [TC 9001] New position submitted",
      outcome: "Failed",
      errorMessage: "expect(locator).toBeVisible() failed",
      stackTrace: EVAL_STACK_AUTH_THIN,
    },
    {
      id: 9002,
      automatedTestName:
        "E2E - Position field update notifications › [TC 9002] Timeline updates",
      outcome: "Failed",
      errorMessage: "expect(locator).toBeVisible() failed",
      stackTrace: EVAL_STACK_LOCATOR_THIN,
    },
  ],
};

export const EVAL_FIXTURE_LOG_LIST = {
  ok: true as const,
  source: "eval-fixture" as const,
  buildId: 1001,
  logs: [
    { id: 7, lineCount: 420, type: "Container" },
    { id: 12, lineCount: 88, type: "Task" },
  ],
  hint: "Pick a logId and call get_log_slice again.",
};

export const EVAL_FIXTURE_LOG_SLICE = {
  ok: true as const,
  source: "eval-fixture" as const,
  buildId: 1001,
  logId: 7,
  offset: 0,
  truncated: false,
  totalChars: 280,
  text: [
    "##[error] expect(locator).toBeVisible() failed on heading [TC 9001]",
    "page.url still https://login.microsoftonline.com/.../oauth2/v2.0/authorize (spa-auth-callback)",
    "##[error] Forecast spinbutton /0[.,]60/ missing after selectAutocomplete (ui-visibility)",
    "##[section]Finishing: Run automation tests",
  ].join("\n"),
};

/** Folder-scope latest-run summary used when session.purpose === "eval". */
export const EVAL_FIXTURE_FOLDER_LATEST = {
  ok: true as const,
  source: "eval-fixture" as const,
  project: "dna-mops-MIPS",
  folderPath: "\\mips-qc\\UAT",
  definitionCount: 2,
  capped: false,
  pipelines: [
    {
      definitionId: 639,
      definitionName: "UAT-MIPS-Automation-No-Cron",
      buildId: 1001,
      buildNumber: "20261123.1",
      result: "failed",
      status: "completed",
      sourceBranch: "refs/heads/main",
      webUrl:
        "https://dev.azure.com/example/Mips/_build/results?buildId=1001",
      totalTests: 12,
      passedTests: 10,
      failedTests: 2,
      skippedTests: 0,
      sampleFailedTests: [
        "[TC 9001] New position submitted",
        "[TC 9002] Timeline updates",
      ],
    },
    {
      definitionId: 640,
      definitionName: "UAT-MIPS-Automation-Cron-Ack",
      buildId: 1002,
      buildNumber: "20261123.2",
      result: "succeeded",
      status: "completed",
      sourceBranch: "refs/heads/main",
      webUrl:
        "https://dev.azure.com/example/Mips/_build/results?buildId=1002",
      totalTests: 8,
      passedTests: 8,
      failedTests: 0,
      skippedTests: 0,
      sampleFailedTests: [],
    },
  ],
  hint: "Folder overview only. For deep RCA, call get_run_summary on one failed buildId.",
};

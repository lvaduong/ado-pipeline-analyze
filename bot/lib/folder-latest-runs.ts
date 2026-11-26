/**
 * List latest completed builds + test counts for every pipeline under an
 * ADO definition folder (e.g. `\mips-qc\UAT`).
 */
import {
  adoFetchJson,
  type AzureCreds,
  MAX_FOLDER_DEFINITIONS,
  MAX_FOLDER_FAILED_SAMPLE,
  type ParsedFolderRef,
  type ToolResultErr,
} from "./azure-devops.js";

type Definition = {
  id: number;
  name?: string;
  path?: string;
};

type DefinitionsList = {
  value?: Definition[];
  count?: number;
};

type Build = {
  id: number;
  buildNumber?: string;
  status?: string;
  result?: string;
  finishTime?: string;
  sourceBranch?: string;
  definition?: { id?: number; name?: string };
  _links?: { web?: { href?: string } };
};

type BuildsList = {
  value?: Build[];
};

type TestRun = {
  id: number;
  name?: string;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  unanalyzedTests?: number;
  notApplicableTests?: number;
  incompleteTests?: number;
  state?: string;
};

type TestRunsList = {
  value?: TestRun[];
};

type TestResult = {
  automatedTestName?: string;
  testCaseTitle?: string;
  outcome?: string;
};

type ResultsPage = {
  value?: TestResult[];
};

export type FolderPipelineSummary = {
  definitionId: number;
  definitionName: string;
  path?: string;
  buildId?: number;
  buildNumber?: string;
  result?: string;
  status?: string;
  finishTime?: string;
  sourceBranch?: string;
  webUrl?: string;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  skippedTests?: number;
  testRuns?: Array<{
    id: number;
    name?: string;
    totalTests?: number;
    passedTests?: number;
    failedTests?: number;
  }>;
  sampleFailedTests: string[];
  note?: string;
};

function failedFromRun(r: TestRun): number {
  const explicit = r.failedTests ?? 0;
  if (explicit > 0) return explicit;
  // Automated Playwright runs often land failures in unanalyzedTests.
  return r.unanalyzedTests ?? 0;
}

function aggregateRuns(runs: TestRun[]): {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  testRuns: FolderPipelineSummary["testRuns"];
} {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let skippedTests = 0;
  const testRuns = runs.map((r) => {
    const failed = failedFromRun(r);
    const total = r.totalTests ?? 0;
    const passed = r.passedTests ?? 0;
    const skipped = Math.max(0, total - passed - failed);
    totalTests += total;
    passedTests += passed;
    failedTests += failed;
    skippedTests += skipped;
    return {
      id: r.id,
      name: r.name,
      totalTests: r.totalTests,
      passedTests: r.passedTests,
      failedTests: failed,
    };
  });
  return { totalTests, passedTests, failedTests, skippedTests, testRuns };
}

async function sampleFailedNames(
  creds: AzureCreds,
  projectEnc: string,
  runs: TestRun[],
  maxSample: number,
): Promise<string[]> {
  const names: string[] = [];
  const failing = runs.filter((r) => failedFromRun(r) > 0);
  const targets = failing.length > 0 ? failing : runs;
  for (const run of targets) {
    if (names.length >= maxSample) break;
    const remaining = maxSample - names.length;
    const resultsPath =
      `${projectEnc}/_apis/test/Runs/${run.id}/results` +
      `?outcomes=Failed&$top=${remaining}&api-version=7.1`;
    const resultsRes = await adoFetchJson<ResultsPage>(creds, resultsPath);
    if (!resultsRes.ok) continue;
    for (const t of resultsRes.data.value ?? []) {
      const name = (t.automatedTestName ?? t.testCaseTitle ?? "").trim();
      if (name) names.push(name);
      if (names.length >= maxSample) break;
    }
  }
  return names;
}

export async function listFolderLatestRuns(
  creds: AzureCreds,
  parsed: ParsedFolderRef,
  opts: {
    maxDefinitions?: number;
    maxFailedSample?: number;
    includeFailedSample?: boolean;
  } = {},
): Promise<
  | {
      ok: true;
      source: "azure-devops";
      project: string;
      folderPath: string;
      definitionCount: number;
      capped: boolean;
      pipelines: FolderPipelineSummary[];
      hint: string;
    }
  | ToolResultErr
> {
  const maxDefs = Math.min(
    Math.max(1, opts.maxDefinitions ?? MAX_FOLDER_DEFINITIONS),
    MAX_FOLDER_DEFINITIONS,
  );
  const maxSample = Math.min(
    Math.max(0, opts.maxFailedSample ?? MAX_FOLDER_FAILED_SAMPLE),
    MAX_FOLDER_FAILED_SAMPLE,
  );
  const includeSample = opts.includeFailedSample !== false && maxSample > 0;

  const projectEnc = encodeURIComponent(parsed.project);
  // ADO matches definitions whose path equals or is under `path`.
  const defsPath =
    `${projectEnc}/_apis/build/definitions?api-version=7.1` +
    `&path=${encodeURIComponent(parsed.folderPath)}` +
    `&$top=${maxDefs}`;
  const defsRes = await adoFetchJson<DefinitionsList>(creds, defsPath);
  if (!defsRes.ok) return defsRes;

  const definitions = [...(defsRes.data.value ?? [])].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
  const capped = definitions.length >= maxDefs;
  const pipelines: FolderPipelineSummary[] = [];

  for (const def of definitions) {
    const buildsPath =
      `${projectEnc}/_apis/build/builds?api-version=7.1` +
      `&definitions=${def.id}` +
      `&$top=1&statusFilter=completed&queryOrder=finishTimeDescending`;
    const buildsRes = await adoFetchJson<BuildsList>(creds, buildsPath);
    if (!buildsRes.ok) {
      pipelines.push({
        definitionId: def.id,
        definitionName: def.name ?? String(def.id),
        path: def.path,
        sampleFailedTests: [],
        note: buildsRes.error,
      });
      continue;
    }

    const build = buildsRes.data.value?.[0];
    if (!build) {
      pipelines.push({
        definitionId: def.id,
        definitionName: def.name ?? String(def.id),
        path: def.path,
        sampleFailedTests: [],
        note: "No completed builds.",
      });
      continue;
    }

    const buildUri = `vstfs:///Build/Build/${build.id}`;
    const runsPath =
      `${projectEnc}/_apis/test/runs?buildUri=${encodeURIComponent(buildUri)}` +
      `&api-version=7.1`;
    const runsRes = await adoFetchJson<TestRunsList>(creds, runsPath);
    const runs = runsRes.ok ? (runsRes.data.value ?? []) : [];
    const agg = aggregateRuns(runs);

    let sampleFailedTests: string[] = [];
    const looksFailed =
      agg.failedTests > 0 ||
      build.result === "failed" ||
      build.result === "partiallySucceeded";
    if (includeSample && looksFailed && runs.length > 0) {
      sampleFailedTests = await sampleFailedNames(
        creds,
        projectEnc,
        runs,
        maxSample,
      );
    }

    pipelines.push({
      definitionId: def.id,
      definitionName: def.name ?? build.definition?.name ?? String(def.id),
      path: def.path,
      buildId: build.id,
      buildNumber: build.buildNumber,
      result: build.result,
      status: build.status,
      finishTime: build.finishTime,
      sourceBranch: build.sourceBranch,
      webUrl: build._links?.web?.href,
      totalTests: agg.totalTests,
      passedTests: agg.passedTests,
      failedTests: agg.failedTests,
      skippedTests: agg.skippedTests,
      testRuns: agg.testRuns,
      sampleFailedTests,
      note: runsRes.ok ? undefined : runsRes.error,
    });
  }

  return {
    ok: true,
    source: "azure-devops",
    project: parsed.project,
    folderPath: parsed.folderPath,
    definitionCount: pipelines.length,
    capped,
    pipelines,
    hint: "Folder overview only. For deep RCA on one failure, call get_run_summary with that build's webUrl/buildId, then list_failed_tests.",
  };
}

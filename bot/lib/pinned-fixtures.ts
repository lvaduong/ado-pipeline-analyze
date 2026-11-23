/**
 * Load pinned Azure tool JSON under fixtures/{buildId}/ for offline smoke.
 * Never used for purpose==="eval" (those use inline EVAL_FIXTURE_*).
 * Live Azure remains the default when AZURE_DEVOPS_PAT is set.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENV_FIXTURE_BUILD = "AZURE_DEVOPS_FIXTURE_BUILD";
const ENV_FIXTURE_DIR = "AZURE_DEVOPS_FIXTURE_DIR";
const ENV_USE_FIXTURES = "AZURE_DEVOPS_USE_FIXTURES";
const ENV_PAT = "AZURE_DEVOPS_PAT";

/** JSON-compatible object — assignable to Agent SDK ToolExecuteResult. */
export type PinnedFixture = {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | PinnedFixture
    | Array<string | number | boolean | null | PinnedFixture>;
  ok: boolean;
  source: "pinned-fixture";
};

function defaultFixturesRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../fixtures");
}

export function fixturesRoot(): string {
  const override = (process.env[ENV_FIXTURE_DIR] ?? "").trim();
  if (override) return path.resolve(override);
  return defaultFixturesRoot();
}

export function pinnedBuildDir(buildId: number): string {
  return path.join(fixturesRoot(), String(buildId));
}

export function hasPinnedBuild(buildId: number): boolean {
  return fs.existsSync(path.join(pinnedBuildDir(buildId), "get_run_summary.json"));
}

/**
 * Decide whether this request should serve pinned fixtures.
 * - AZURE_DEVOPS_FIXTURE_BUILD=104954 → force that build's fixtures
 * - AZURE_DEVOPS_USE_FIXTURES=1 + matching fixtures/{buildId} → force
 * - No PAT + fixtures/{buildId} exists → offline auto-fallback
 * - PAT set → live Azure (caller continues)
 */
export function resolvePinnedBuildId(buildId?: number): number | undefined {
  const forced = (process.env[ENV_FIXTURE_BUILD] ?? "").trim();
  if (forced && /^\d+$/.test(forced)) {
    const id = Number(forced);
    return hasPinnedBuild(id) ? id : undefined;
  }

  if (buildId == null || !hasPinnedBuild(buildId)) return undefined;

  if ((process.env[ENV_USE_FIXTURES] ?? "").trim() === "1") return buildId;

  const pat = (process.env[ENV_PAT] ?? "").trim();
  if (!pat) return buildId;

  return undefined;
}

/**
 * Read fixtures/{buildId}/{fileBase}.json and stamp source=pinned-fixture.
 * Returns null if the file is missing.
 */
export function loadPinnedFixture(
  buildId: number,
  fileBase: string,
): PinnedFixture | null {
  const filePath = path.join(pinnedBuildDir(buildId), `${fileBase}.json`);
  if (!fs.existsSync(filePath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const body =
    obj.result && typeof obj.result === "object" && !Array.isArray(obj.result)
      ? (obj.result as Record<string, unknown>)
      : obj;
  return {
    ...(body as PinnedFixture),
    ok: body.ok !== false,
    source: "pinned-fixture",
  };
}

export function missingPinnedFixture(
  buildId: number,
  fileBase: string,
): PinnedFixture {
  return {
    ok: false,
    source: "pinned-fixture",
    error: `Pinned fixture missing: fixtures/${buildId}/${fileBase}.json`,
    hint: `Capture with agent-sdk tool call while AZURE_DEVOPS_PAT is set, or unset ${ENV_FIXTURE_BUILD} to use live Azure.`,
  };
}

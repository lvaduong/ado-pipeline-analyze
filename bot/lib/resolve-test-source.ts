/**
 * Map ADO failed-test names / stacks → likely paths under a local
 * dna-automation-test checkout. Read-only Node fs only (no shell).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENV_ROOT = "DNA_AUTOMATION_TEST_ROOT";

/** Skip heavy / irrelevant trees while walking. */
const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "test-results",
  "playwright-report",
  ".tmp",
  "artifacts",
  "outputs",
  "hillclimb-traces",
  ".agent-serve",
]);

const MAX_MATCHES_PER_QUERY = 6;
const MAX_WALK_FILES = 8_000;
const MAX_CONTENT_HITS = 40;

export type ResolveQuery = {
  /** Result id from list_failed_tests when known. */
  resultId?: number;
  /** automatedTestName or testCaseTitle. */
  testName?: string;
  /** Optional stackTrace / errorMessage for path extraction. */
  stackTrace?: string;
};

export type ResolvedMatch = {
  path: string;
  absolutePath: string;
  reason: string;
  score: number;
};

export type ResolveQueryResult = {
  resultId?: number;
  testName?: string;
  matches: ResolvedMatch[];
};

function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  if (p === "~") return os.homedir();
  return p;
}

/** Candidate checkout roots, first existing wins. */
export function candidateCheckoutRoots(): string[] {
  const fromEnv = (process.env[ENV_ROOT] ?? "").trim();
  const home = os.homedir();
  const list = [
    fromEnv ? expandHome(fromEnv) : "",
    path.join(home, "Documents", "dna-automation-test"),
    path.join(home, "Documents", "MODEC", "dna-automation-test"),
    path.join(home, "src", "dna-automation-test"),
    path.join(home, "dna-automation-test"),
  ].filter(Boolean);
  return [...new Set(list.map((p) => path.resolve(p)))];
}

export function resolveCheckoutRoot(
  override?: string,
):
  | { ok: true; root: string; source: string }
  | { ok: false; tried: string[]; missingEnvHint: string } {
  if (override?.trim()) {
    const root = path.resolve(expandHome(override.trim()));
    if (fs.existsSync(root) && fs.statSync(root).isDirectory()) {
      return { ok: true, root, source: "checkoutRoot" };
    }
    return {
      ok: false,
      tried: [root],
      missingEnvHint: `checkoutRoot does not exist: ${root}`,
    };
  }

  const tried: string[] = [];
  for (const root of candidateCheckoutRoots()) {
    tried.push(root);
    try {
      if (
        fs.existsSync(root) &&
        fs.statSync(root).isDirectory() &&
        (fs.existsSync(path.join(root, "projects")) ||
          fs.existsSync(path.join(root, "packages")))
      ) {
        const source = process.env[ENV_ROOT]?.trim()
          ? ENV_ROOT
          : "default-Documents";
        return { ok: true, root, source };
      }
    } catch {
      // continue
    }
  }

  return {
    ok: false,
    tried,
    missingEnvHint: `Set ${ENV_ROOT} to the dna-automation-test checkout path.`,
  };
}

function toRepoRelative(root: string, absolute: string): string {
  const rel = path.relative(root, absolute);
  return rel.split(path.sep).join("/");
}

/** Paths that look like repo-relative source files. */
function extractPathHints(text: string): string[] {
  const hints = new Set<string>();

  // Agent / CI absolute: /home/vsts/work/1/s/projects/...
  const absRe =
    /(?:\/home\/vsts\/work\/\d+\/s\/|(?:[A-Za-z]:)?(?:\/[\w.-]+)+\/)((?:projects|packages)\/[\w./-]+\.(?:ts|tsx|js|mjs|cjs))/g;
  for (const m of text.matchAll(absRe)) {
    if (m[1]) hints.add(m[1].replace(/\\/g, "/"));
  }

  // Bare projects|packages paths
  const projRe =
    /((?:projects|packages)\/[\w./-]+\.(?:ts|tsx|js|mjs|cjs))/g;
  for (const m of text.matchAll(projRe)) {
    if (m[1]) hints.add(m[1].replace(/\\/g, "/"));
  }

  // Playwright title line: › ui/notifications/foo.spec.ts:12:34
  const pwRe =
    /[›>]\s*((?:ui|api|e2e|unit)\/[\w./-]+\.spec\.ts)(?::\d+)?/gi;
  for (const m of text.matchAll(pwRe)) {
    if (m[1]) hints.add(m[1].replace(/\\/g, "/"));
  }

  // Relative page/helpers: ../src/pages/foo.ts or at ../src/db/bar.ts
  const relSrcRe =
    /(?:\bat\s+)?(?:\.\.\/)+((?:src|tests)\/[\w./-]+\.(?:ts|tsx))/g;
  for (const m of text.matchAll(relSrcRe)) {
    if (m[1]) hints.add(m[1].replace(/\\/g, "/"));
  }

  // Bare filename.spec.ts
  const fileRe = /\b([\w-]+\.spec\.ts)\b/g;
  for (const m of text.matchAll(fileRe)) {
    if (m[1]) hints.add(m[1]);
  }

  return [...hints];
}

function extractTcIds(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/\[?\s*TC\s*(\d{4,6})\s*\]?/gi)) {
    if (m[1]) ids.add(m[1]);
  }
  return [...ids];
}

function walkFiles(
  root: string,
  opts: { under?: string[]; maxFiles?: number },
): string[] {
  const maxFiles = opts.maxFiles ?? MAX_WALK_FILES;
  const bases =
    opts.under && opts.under.length > 0
      ? opts.under.map((u) => path.join(root, u))
      : [root];
  const out: string[] = [];

  const stack: string[] = [];
  for (const b of bases) {
    if (fs.existsSync(b)) stack.push(b);
  }

  while (stack.length > 0 && out.length < maxFiles) {
    const dir = stack.pop();
    if (!dir) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) break;
      const name = ent.name;
      const full = path.join(dir, name);
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(name) || name.startsWith(".")) continue;
        stack.push(full);
      } else if (ent.isFile() && /\.(ts|tsx|js|mjs|cjs)$/.test(name)) {
        out.push(full);
      }
    }
  }
  return out;
}

function scoreMatch(reason: string): number {
  if (reason.startsWith("stack-absolute")) return 100;
  if (reason.startsWith("stack-projects")) return 95;
  if (reason.startsWith("stack-playwright")) return 90;
  if (reason.startsWith("stack-relative-src")) return 85;
  if (reason.startsWith("tc-id")) return 80;
  if (reason.startsWith("basename")) return 60;
  return 40;
}

function dedupeMatches(matches: ResolvedMatch[]): ResolvedMatch[] {
  const byPath = new Map<string, ResolvedMatch>();
  for (const m of matches) {
    const prev = byPath.get(m.path);
    if (!prev || m.score > prev.score) byPath.set(m.path, m);
  }
  return [...byPath.values()]
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, MAX_MATCHES_PER_QUERY);
}

function resolveHintAgainstRoot(
  root: string,
  hint: string,
  reasonPrefix: string,
): ResolvedMatch[] {
  const matches: ResolvedMatch[] = [];
  const normalized = hint.replace(/\\/g, "/").replace(/^\.\//, "");

  // Full repo-relative
  if (
    normalized.startsWith("projects/") ||
    normalized.startsWith("packages/")
  ) {
    const abs = path.join(root, ...normalized.split("/"));
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      matches.push({
        path: normalized,
        absolutePath: abs,
        reason: `${reasonPrefix}:${normalized}`,
        score: scoreMatch(reasonPrefix),
      });
      return matches;
    }
  }

  // Playwright-relative under projects/*/tests/
  if (/^(ui|api|e2e|unit)\//.test(normalized)) {
    const projectsDir = path.join(root, "projects");
    if (fs.existsSync(projectsDir)) {
      for (const proj of fs.readdirSync(projectsDir)) {
        const candidate = path.join(
          projectsDir,
          proj,
          "tests",
          ...normalized.split("/"),
        );
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          const rel = toRepoRelative(root, candidate);
          matches.push({
            path: rel,
            absolutePath: candidate,
            reason: `stack-playwright:${normalized}`,
            score: scoreMatch("stack-playwright"),
          });
        }
      }
    }
  }

  // src/... under projects/*
  if (normalized.startsWith("src/") || normalized.startsWith("tests/")) {
    const projectsDir = path.join(root, "projects");
    if (fs.existsSync(projectsDir)) {
      for (const proj of fs.readdirSync(projectsDir)) {
        const candidate = path.join(
          projectsDir,
          proj,
          ...normalized.split("/"),
        );
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          const rel = toRepoRelative(root, candidate);
          matches.push({
            path: rel,
            absolutePath: candidate,
            reason: `stack-relative-src:${normalized}`,
            score: scoreMatch("stack-relative-src"),
          });
        }
      }
    }
  }

  // basename only — scan limited trees
  if (/^[\w-]+\.spec\.ts$/.test(normalized) || /^[\w-]+\.ts$/.test(normalized)) {
    const files = walkFiles(root, {
      under: ["projects", "packages"],
      maxFiles: MAX_WALK_FILES,
    });
    for (const abs of files) {
      if (path.basename(abs) === normalized) {
        matches.push({
          path: toRepoRelative(root, abs),
          absolutePath: abs,
          reason: `basename:${normalized}`,
          score: scoreMatch("basename"),
        });
      }
    }
  }

  return matches;
}

function searchTcInCheckout(root: string, tcId: string): ResolvedMatch[] {
  const needle = `TC ${tcId}`;
  const needleAlt = `TC${tcId}`;
  const files = walkFiles(root, {
    under: ["projects", "packages"],
    maxFiles: MAX_WALK_FILES,
  });
  const hits: ResolvedMatch[] = [];
  let contentHits = 0;
  for (const abs of files) {
    if (contentHits >= MAX_CONTENT_HITS) break;
    // Prefer specs and nearby helpers
    if (!/\.(spec\.)?tsx?$/.test(abs)) continue;
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (text.includes(needle) || text.includes(needleAlt) || text.includes(`[TC ${tcId}]`)) {
      contentHits += 1;
      hits.push({
        path: toRepoRelative(root, abs),
        absolutePath: abs,
        reason: `tc-id:${tcId}`,
        score: scoreMatch("tc-id") + (abs.includes(".spec.") ? 5 : 0),
      });
    }
  }
  return hits;
}

export function resolveQueries(
  root: string,
  queries: ResolveQuery[],
): ResolveQueryResult[] {
  return queries.map((q) => {
    const blob = [q.testName ?? "", q.stackTrace ?? ""].join("\n");
    const collected: ResolvedMatch[] = [];

    const hints = extractPathHints(blob);
    for (const hint of hints) {
      let prefix = "stack-projects";
      if (hint.startsWith("projects/") || hint.startsWith("packages/")) {
        prefix = hint.includes("/home/vsts")
          ? "stack-absolute"
          : "stack-projects";
      } else if (/^(ui|api|e2e|unit)\//.test(hint)) {
        prefix = "stack-playwright";
      } else if (hint.startsWith("src/") || hint.startsWith("tests/")) {
        prefix = "stack-relative-src";
      } else if (hint.endsWith(".spec.ts") || hint.endsWith(".ts")) {
        prefix = "basename";
      }
      // Prefer absolute-looking projects/ packages from extractPathHints
      if (
        (hint.startsWith("projects/") || hint.startsWith("packages/")) &&
        blob.includes(`/s/${hint}`)
      ) {
        prefix = "stack-absolute";
      }
      collected.push(...resolveHintAgainstRoot(root, hint, prefix));
    }

    for (const tc of extractTcIds(blob)) {
      collected.push(...searchTcInCheckout(root, tc));
    }

    return {
      resultId: q.resultId,
      testName: q.testName,
      matches: dedupeMatches(collected),
    };
  });
}

/** Compact eval fixture — mirrors real mips paths without touching disk. */
export const EVAL_FIXTURE_RESOLVE = {
  ok: true as const,
  source: "eval-fixture" as const,
  checkoutRoot: "/eval/dna-automation-test",
  results: [
    {
      resultId: 9001,
      testName:
        "E2E - New position request updates › [TC 9001] New position submitted",
      matches: [
        {
          path: "projects/mips/tests/ui/notifications/new-position-request-updates.spec.ts",
          absolutePath:
            "/eval/dna-automation-test/projects/mips/tests/ui/notifications/new-position-request-updates.spec.ts",
          reason: "tc-id:9001",
          score: 85,
        },
      ],
    },
    {
      resultId: 9002,
      testName:
        "E2E - Position field update notifications › [TC 9002] Timeline updates",
      matches: [
        {
          path: "projects/mips/tests/ui/notifications/position-field-updates.spec.ts",
          absolutePath:
            "/eval/dna-automation-test/projects/mips/tests/ui/notifications/position-field-updates.spec.ts",
          reason: "tc-id:9002",
          score: 85,
        },
        {
          path: "projects/mips/src/pages/requisition-details-page.ts",
          absolutePath:
            "/eval/dna-automation-test/projects/mips/src/pages/requisition-details-page.ts",
          reason: "stack-relative-src:src/pages/requisition-details-page.ts",
          score: 85,
        },
      ],
    },
  ],
};

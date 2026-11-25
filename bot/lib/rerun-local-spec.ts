/**
 * One local Playwright re-run. Working directory and command are fixed.
 * The model may pass a single spec path under projects/mips/tests.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";

export const CHECKOUT_ROOT =
  "/Users/duong.lemodec.com/Documents/dna-automation-test";

/** At least 15 minutes so a single UAT spec is not killed mid-run. */
export const RERUN_TIMEOUT_MS = 15 * 60 * 1000;

const SPEC_PATH =
  /^projects\/mips\/tests\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.spec\.ts$/;

export type PlaywrightSummary = {
  failed: number;
  flaky: number;
  passed: number;
};

export type LocalResult = "local-reproduced" | "local-passed";

/** Short failure excerpt. Omitted entirely when the spec passes. */
export type FailureExcerpt = {
  error: string;
  expected?: string;
  received?: string;
  frame?: string;
};

const MAX_ERROR_CHARS = 240;
const MAX_VALUE_CHARS = 180;

export function normalizeSpecPath(
  input: string,
): { ok: true; specPath: string } | { ok: false; error: string } {
  const specPath = input.trim().replace(/^\.\//, "");
  if (
    specPath.startsWith("/") ||
    specPath.includes("\\") ||
    specPath.split("/").includes("..")
  ) {
    return {
      ok: false,
      error: "spec path must be one relative file under projects/mips/tests",
    };
  }
  if (!SPEC_PATH.test(specPath)) {
    return {
      ok: false,
      error:
        "spec path must be one *.spec.ts file under projects/mips/tests (no extra args)",
    };
  }
  return { ok: true, specPath };
}

/**
 * Playwright's list reporter prints "N failed" / "N flaky" / "N passed"
 * and omits a count when it is zero. Use the last match of each.
 */
export function parsePlaywrightSummary(tail: string): PlaywrightSummary | null {
  const failed = lastCount(tail, "failed");
  const flaky = lastCount(tail, "flaky");
  const passed = lastCount(tail, "passed");
  if (failed == null && flaky == null && passed == null) {
    return null;
  }
  return {
    failed: failed ?? 0,
    flaky: flaky ?? 0,
    passed: passed ?? 0,
  };
}

export function classifyLocalResult(
  exitCode: number,
  summary: PlaywrightSummary | null,
): LocalResult {
  if (exitCode !== 0 || (summary != null && summary.failed > 0)) {
    return "local-reproduced";
  }
  return "local-passed";
}

/**
 * First Playwright failure in the log tail, capped.
 * Error line, expected/received values, and the first spec or page-object frame.
 * Returns null when those lines are absent (including a clean pass).
 */
export function parseFailureExcerpt(log: string): FailureExcerpt | null {
  const text = stripAnsi(log);
  const summaryAt = text.search(/(?:^|\n)\s*\d+\s+failed\b/);
  const window =
    summaryAt >= 0 ? text.slice(Math.max(0, summaryAt - 8_000), summaryAt) : text.slice(-8_000);
  const headers = [...window.matchAll(/(?:^|\n)\s*\d+\)\s/g)];
  const block =
    headers.length > 0
      ? window.slice(headers[headers.length - 1].index ?? 0)
      : window;

  const errorMatch = block.match(/(?:^|\n)\s*(Error:.*)/);
  if (errorMatch?.[1] == null) {
    return null;
  }

  const expected = firstValue(block, "Expected");
  const received = firstValue(block, "Received");
  const frame = firstSpecOrPageFrame(block) ?? frameFromHeader(block);

  return {
    error: cap(errorMatch[1], MAX_ERROR_CHARS),
    ...(expected != null ? { expected } : {}),
    ...(received != null ? { received } : {}),
    ...(frame != null ? { frame } : {}),
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function cap(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, max - 1)}…`;
}

function firstValue(block: string, label: "Expected" | "Received"): string | null {
  const labeled = block.match(
    new RegExp(String.raw`(?:^|\n)\s*${label}\b[^:\n]*:\s*(.+)`),
  );
  if (labeled?.[1] != null && labeled[1].trim() !== "") {
    return cap(labeled[1], MAX_VALUE_CHARS);
  }
  const sign = label === "Expected" ? "-" : "\\+";
  const diff = block.match(
    new RegExp(String.raw`(?:^|\n)\s*${sign} ${label}\s*\n([^\n]+)`),
  );
  if (diff?.[1] == null) {
    return null;
  }
  return cap(diff[1].replace(/^\s*[+-]\s*/, ""), MAX_VALUE_CHARS);
}

function firstSpecOrPageFrame(block: string): string | null {
  const frames = block.matchAll(
    /(?:^|\n)\s*at (?:async )?(?:[^\n]*?\()?([^\s()]+?):(\d+)(?::\d+)?\)?/g,
  );
  for (const match of frames) {
    const file = match[1];
    if (file == null || match[2] == null) {
      continue;
    }
    if (file.includes("node_modules") || !isSpecOrPage(file)) {
      continue;
    }
    return `${toRepoPath(file)}:${match[2]}`;
  }
  return null;
}

function frameFromHeader(block: string): string | null {
  const header = block.match(/›\s+([^\s›]+?\.spec\.ts):(\d+):\d+/);
  if (header?.[1] == null || header[2] == null) {
    return null;
  }
  return `${toRepoPath(header[1])}:${header[2]}`;
}

function isSpecOrPage(file: string): boolean {
  const norm = file.replace(/\\/g, "/");
  return (
    norm.endsWith(".spec.ts") ||
    norm.endsWith("-page.ts") ||
    norm.includes("/pages/")
  );
}

function toRepoPath(file: string): string {
  const norm = file.replace(/\\/g, "/");
  const checkout = "/dna-automation-test/";
  const checkoutAt = norm.indexOf(checkout);
  if (checkoutAt >= 0) {
    return norm.slice(checkoutAt + checkout.length);
  }
  const projectsAt = norm.indexOf("projects/");
  if (projectsAt >= 0) {
    return norm.slice(projectsAt);
  }
  const packagesAt = norm.indexOf("packages/");
  if (packagesAt >= 0) {
    return norm.slice(packagesAt);
  }
  return norm;
}

function lastCount(tail: string, label: "failed" | "flaky" | "passed"): number | null {
  const matches = tail.matchAll(
    new RegExp(String.raw`(?:^|\n)\s*(\d+)\s+${label}\b`, "g"),
  );
  let last: number | null = null;
  for (const match of matches) {
    last = Number(match[1]);
  }
  return last;
}

export function checkoutStatus():
  | { ok: true }
  | { ok: false; gap: "checkout-missing"; error: string } {
  if (!fs.existsSync(CHECKOUT_ROOT) || !fs.statSync(CHECKOUT_ROOT).isDirectory()) {
    return {
      ok: false,
      gap: "checkout-missing",
      error: `dna-automation-test checkout not found at ${CHECKOUT_ROOT}`,
    };
  }
  const pkg = `${CHECKOUT_ROOT}/package.json`;
  const workspace = `${CHECKOUT_ROOT}/projects/mips/package.json`;
  if (!fs.existsSync(pkg) || !fs.existsSync(workspace)) {
    return {
      ok: false,
      gap: "checkout-missing",
      error: `dna-automation-test checkout at ${CHECKOUT_ROOT} is missing package.json or projects/mips/package.json`,
    };
  }
  return { ok: true };
}

type RunOutcome = {
  ok: true;
  exitCode: number | null;
  timedOut: boolean;
  summary: PlaywrightSummary | null;
  localResult: LocalResult | null;
  failure: FailureExcerpt | null;
};

type RunFailure = {
  ok: false;
  gap: "runner-missing" | "checkout-missing";
  error: string;
};

export async function runLocalSpec(specPath: string): Promise<RunOutcome | RunFailure> {
  const checkout = checkoutStatus();
  if (!checkout.ok) {
    return checkout;
  }

  return await new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let tail = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: RunOutcome | RunFailure) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer != null) {
        clearTimeout(timer);
      }
      resolve(value);
    };
    const child = spawn(
      "npm",
      ["run", "test", "-w", "projects/mips", "--", specPath],
      {
        cwd: CHECKOUT_ROOT,
        env: { ...process.env, ENV: "uat" },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const append = (chunk: Buffer) => {
      tail = (tail + chunk.toString("utf8")).slice(-32_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const killGroup = (signal: NodeJS.Signals) => {
      if (child.pid == null) {
        return;
      }
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    };

    timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 5_000).unref();
    }, RERUN_TIMEOUT_MS);

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        finish({
          ok: false,
          gap: "runner-missing",
          error: "npm was not found on PATH, so the local spec runner cannot start.",
        });
        return;
      }
      finish({
        ok: false,
        gap: "runner-missing",
        error: `local spec runner failed to start: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      const summary = parsePlaywrightSummary(tail);
      const exitCode = code;
      const localResult =
        exitCode == null || timedOut
          ? null
          : classifyLocalResult(exitCode, summary);
      finish({
        ok: true,
        exitCode,
        timedOut,
        summary,
        localResult,
        failure: localResult === "local-reproduced" ? parseFailureExcerpt(tail) : null,
      });
    });
  });
}

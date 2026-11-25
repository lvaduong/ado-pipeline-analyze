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
      finish({
        ok: true,
        exitCode,
        timedOut,
        summary,
        localResult:
          exitCode == null || timedOut
            ? null
            : classifyLocalResult(exitCode, summary),
      });
    });
  });
}

/**
 * Read and patch automation source under the dna-automation-test checkout.
 * Paths stay inside projects/mips/tests and projects/mips/src. No shell.
 */

import fs from "node:fs";
import path from "node:path";
import { CHECKOUT_ROOT } from "./rerun-local-spec.js";

const AUTOMATION_FILE =
  /^projects\/mips\/(?:tests|src)\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.ts$/;

const DEFAULT_MAX_LINES = 80;
const HARD_MAX_LINES = 120;
const MAX_READ_CHARS = 6_000;
const MIN_OLD_CHARS = 8;
const MAX_OLD_CHARS = 1_500;
const MAX_NEW_CHARS = 2_000;

export function normalizeAutomationPath(
  input: string,
): { ok: true; relPath: string } | { ok: false; error: string } {
  const relPath = input.trim().replace(/^\.\//, "");
  if (
    relPath.startsWith("/") ||
    relPath.includes("\\") ||
    relPath.split("/").includes("..")
  ) {
    return {
      ok: false,
      error: "path must stay under projects/mips/tests or projects/mips/src",
    };
  }
  if (!AUTOMATION_FILE.test(relPath)) {
    return {
      ok: false,
      error:
        "path must be one .ts file under projects/mips/tests or projects/mips/src",
    };
  }
  return { ok: true, relPath };
}

export function readAutomationSource(
  relPath: string,
  options?: { startLine?: number; maxLines?: number; root?: string },
):
  | {
      ok: true;
      path: string;
      startLine: number;
      endLine: number;
      text: string;
      truncated: boolean;
    }
  | { ok: false; error: string; path?: string } {
  const rooted = resolveInsideCheckout(relPath, options?.root ?? CHECKOUT_ROOT);
  if (!rooted.ok) {
    return rooted;
  }
  const raw = fs.readFileSync(rooted.abs, "utf8");
  const lines = raw.split(/\r?\n/);
  const startLine = Math.max(1, options?.startLine ?? 1);
  const maxLines = Math.min(
    HARD_MAX_LINES,
    Math.max(1, options?.maxLines ?? DEFAULT_MAX_LINES),
  );
  const slice = lines.slice(startLine - 1, startLine - 1 + maxLines);
  let text = slice
    .map((line, index) => `${startLine + index}|${line}`)
    .join("\n");
  let truncated = startLine - 1 + slice.length < lines.length;
  if (text.length > MAX_READ_CHARS) {
    text = `${text.slice(0, MAX_READ_CHARS - 1)}…`;
    truncated = true;
  }
  return {
    ok: true,
    path: relPath,
    startLine,
    endLine: startLine + slice.length - 1,
    text,
    truncated,
  };
}

export function applyAutomationFix(
  relPath: string,
  oldText: string,
  newText: string,
  root: string = CHECKOUT_ROOT,
):
  | { ok: true; path: string; replacements: 1 }
  | { ok: false; error: string; path?: string } {
  if (oldText.length < MIN_OLD_CHARS || oldText.length > MAX_OLD_CHARS) {
    return {
      ok: false,
      error: `oldText must be ${MIN_OLD_CHARS}-${MAX_OLD_CHARS} characters and unique in the file`,
    };
  }
  if (newText.length > MAX_NEW_CHARS) {
    return { ok: false, error: `newText must be at most ${MAX_NEW_CHARS} characters` };
  }
  if (oldText === newText) {
    return { ok: false, error: "oldText and newText are the same" };
  }
  const rooted = resolveInsideCheckout(relPath, root);
  if (!rooted.ok) {
    return rooted;
  }
  const raw = fs.readFileSync(rooted.abs, "utf8");
  const hits = countOccurrences(raw, oldText);
  if (hits === 0) {
    return {
      ok: false,
      path: relPath,
      error: "oldText was not found. Read the file and pass the exact current text.",
    };
  }
  if (hits > 1) {
    return {
      ok: false,
      path: relPath,
      error: "oldText matched more than once. Include more surrounding lines so it is unique.",
    };
  }
  fs.writeFileSync(rooted.abs, raw.replace(oldText, newText), "utf8");
  return { ok: true, path: relPath, replacements: 1 };
}

function resolveInsideCheckout(
  relPath: string,
  root: string,
): { ok: true; abs: string } | { ok: false; error: string; path: string } {
  const normalized = normalizeAutomationPath(relPath);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error, path: relPath };
  }
  if (!fs.existsSync(root)) {
    return {
      ok: false,
      path: normalized.relPath,
      error: `checkout not found at ${root}`,
    };
  }
  const rootReal = fs.realpathSync(root);
  const abs = path.resolve(rootReal, normalized.relPath);
  if (!fs.existsSync(abs)) {
    return {
      ok: false,
      path: normalized.relPath,
      error: `file not found: ${normalized.relPath}`,
    };
  }
  const real = fs.realpathSync(abs);
  if (real !== rootReal && !real.startsWith(`${rootReal}${path.sep}`)) {
    return {
      ok: false,
      path: normalized.relPath,
      error: "path escapes the checkout",
    };
  }
  return { ok: true, abs: real };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) {
      return count;
    }
    count += 1;
    from = at + needle.length;
  }
  return count;
}

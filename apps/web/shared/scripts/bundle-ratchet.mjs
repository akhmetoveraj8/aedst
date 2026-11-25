// Budget ratchet for bundle-budget.json, shared by check-bundle-size.mjs and
// its test. A limit may only go up when the same change records why: an
// entry in the budget's `increases` array that the base version does not
// have, naming the limit and its old and new value:
//
//   "increases": [
//     { "date": "2026-11-25", "limit": "totalJsGzipKB", "old": 905, "new": 992,
//       "reason": "Sentry 11.17.0 and posthog-js 1.454.1 (owner decision)" }
//   ]
//
// Limit keys: the top-level `*KB` numbers (`totalJsGzipKB`), `modules.<id>`
// (its `firstLoadGzipKB`) and `shell.<route>`. The base is the budget at the
// merge-base with origin/main; without git history the ratchet is skipped
// with a notice. Uses only node built-ins.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Measured usage this far under a limit prints a "can be lowered" hint. */
export const SLACK_RATIO = 0.95;
/** Headroom a suggested limit keeps above the measured value (the budgets' ~3 % convention). */
export const HEADROOM_RATIO = 1.03;

/**
 * Every numeric limit of a budget file, keyed as described above.
 * @param {Record<string, unknown>} budget
 * @returns {Map<string, number>}
 */
export function flattenLimits(budget) {
  const limits = new Map();
  for (const [key, value] of Object.entries(budget)) {
    if (key.endsWith("KB") && typeof value === "number") {
      limits.set(key, value);
    }
  }
  const modules = isRecord(budget.modules) ? budget.modules : {};
  for (const [id, entry] of Object.entries(modules)) {
    if (isRecord(entry) && typeof entry.firstLoadGzipKB === "number") {
      limits.set(`modules.${id}`, entry.firstLoadGzipKB);
    }
  }
  const shell = isRecord(budget.shell) ? budget.shell : {};
  for (const [route, value] of Object.entries(shell)) {
    if (typeof value === "number") {
      limits.set(`shell.${route}`, value);
    }
  }
  return limits;
}

/**
 * Limits that are higher in `head` than in `base`. A limit new in `head` is
 * not a raise (a new route or module needs a first budget).
 * @returns {{ limit: string, old: number, new: number }[]}
 */
export function raisedLimits(base, head) {
  const before = flattenLimits(base);
  const raised = [];
  for (const [limit, value] of flattenLimits(head)) {
    const old = before.get(limit);
    if (old !== undefined && value > old) {
      raised.push({ limit, old, new: value });
    }
  }
  return raised;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Raised limits that no newly added, well-formed `increases` entry explains.
 * @returns {{ limit: string, old: number, new: number, why: string }[]}
 */
export function unjustifiedRaises(base, head) {
  const known = new Set(increases(base).map((entry) => JSON.stringify(entry)));
  const added = increases(head).filter(
    (entry) => !known.has(JSON.stringify(entry)),
  );
  const problems = [];
  for (const raise of raisedLimits(base, head)) {
    const entry = added.find(
      (candidate) =>
        candidate.limit === raise.limit &&
        candidate.old === raise.old &&
        candidate.new === raise.new,
    );
    if (!entry) {
      problems.push({
        ...raise,
        why: `no new "increases" entry with limit "${raise.limit}", old ${raise.old}, new ${raise.new}`,
      });
    } else if (typeof entry.date !== "string" || !DATE.test(entry.date)) {
      problems.push({
        ...raise,
        why: "its increases entry has no YYYY-MM-DD date",
      });
    } else if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      problems.push({ ...raise, why: "its increases entry has no reason" });
    }
  }
  return problems;
}

/**
 * The limit to suggest when measured usage sits more than 5 % under it, or
 * null when the limit is tight enough.
 * @param {number} actual
 * @param {number} limit
 */
export function lowerableTo(actual, limit) {
  if (actual >= limit * SLACK_RATIO) {
    return null;
  }
  const suggested = Math.ceil(actual * HEADROOM_RATIO * 10) / 10;
  return suggested < limit ? suggested : null;
}

/**
 * The project's budget at the merge-base with origin/main, or a notice why
 * there is none to compare with.
 * @param {string} budgetPath absolute path of bundle-budget.json
 * @returns {{ base: Record<string, unknown> } | { notice: string }}
 */
export function baseBudget(budgetPath) {
  const git = (args) =>
    execFileSync("git", args, {
      cwd: dirname(budgetPath),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  let mergeBase;
  let file;
  try {
    const top = git(["rev-parse", "--show-toplevel"]);
    file = relative(top, budgetPath).replaceAll("\\", "/");
    mergeBase = git(["merge-base", "HEAD", "origin/main"]);
  } catch {
    return {
      notice:
        "budget ratchet skipped: no git history or no origin/main to compare with",
    };
  }
  try {
    return { base: JSON.parse(git(["show", `${mergeBase}:${file}`])) };
  } catch {
    return {
      notice: `budget ratchet skipped: ${file} does not exist at the merge-base`,
    };
  }
}

function increases(budget) {
  return Array.isArray(budget.increases)
    ? budget.increases.filter(isRecord)
    : [];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// CLI for the negative self-test (app/scripts/check-selftest.mjs, run kind
// "ratchet"): compares two budget files without git and exits 1 on an
// unjustified raise.
//   node bundle-ratchet.mjs <base-budget.json> <head-budget.json>
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const [basePath, headPath] = process.argv.slice(2);
  if (!basePath || !headPath) {
    console.error(
      "usage: bundle-ratchet.mjs <base-budget.json> <head-budget.json>",
    );
    process.exit(2);
  }
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const problems = unjustifiedRaises(read(basePath), read(headPath));
  for (const problem of problems) {
    console.log(
      `FAIL ${problem.limit} raised ${problem.old} -> ${problem.new}: ${problem.why}`,
    );
  }
  if (problems.length > 0) {
    process.exit(1);
  }
  console.log("OK: no limit raised without an increases entry");
}

#!/usr/bin/env node
// Performance budget for the client bundle of ONE web project. Run from the
// project directory after its build (`pnpm check:bundle` in app, marketing and
// admin), or pass the project directory as the first argument:
//
//   node ../shared/scripts/check-bundle-size.mjs [project-dir]
//
// Sums the gzip size of every emitted client JS and CSS asset and fails when
// a budget in the project's `bundle-budget.json` is exceeded, so a dependency
// or import that quietly adds 100 KB shows up as a red CI check on the pull
// request that introduced it, not as a Lighthouse regression weeks later.
// (Core Web Vitals budgets live in `lighthouserc.json`.)
//
// bundle-budget.json:
//   staticDir            emitted assets, default ".next/static" (admin: "dist/assets")
//   totalJsGzipKB        every emitted JS chunk
//   largestJsChunkGzipKB the heaviest single chunk
//   totalCssGzipKB       every emitted stylesheet
//   totalFontKB          optional: font files on disk (WOFF2 is already compressed)
//   entryHtml + entryJsGzipKB
//                        optional (Vite SPA): the scripts and modulepreloads the
//                        built HTML references, i.e. what every visit downloads
//   modules / shell      optional (Next.js): PER-MODULE first-load budgets, the
//                        gzip JS of the heaviest route of each feature module,
//                        read from `.next/diagnostics/route-bundle-stats.json`.
//                        Every route must belong to a budgeted module or the
//                        `shell` list, so a new route cannot ship without one.
//
// Any budget at 95 % or more of its limit prints WARN (the build still passes);
// one more than 5 % under its limit prints a "can be lowered to X" hint.
//
// Ratchet (bundle-ratchet.mjs): a limit higher than at the merge-base with
// origin/main fails unless the same change adds an `increases` entry
// { date, limit, old, new, reason } for it.
// Uses only node built-ins.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import {
  baseBudget,
  lowerableTo,
  unjustifiedRaises,
} from "./bundle-ratchet.mjs";
import {
  budgetStatus,
  containsReplayRecorder,
  entryScripts,
  STATUS_LABEL,
} from "./bundle-status.mjs";

const rootDir = resolve(process.argv[2] ?? process.cwd());
const budgetPath = join(rootDir, "bundle-budget.json");
const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
/** Measured value per limit key (see bundle-ratchet.mjs), for the lowering hints. */
const measured = new Map();
const staticDir = join(rootDir, budget.staticDir ?? ".next/static");
const FONT_EXTENSIONS = new Set([".woff2", ".woff", ".ttf", ".otf"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else {
      yield path;
    }
  }
}

let files;
try {
  files = [...walk(staticDir)];
} catch {
  console.error("No build output found: run `pnpm build` first.");
  process.exit(2);
}

const assets = files
  .filter((path) => [".js", ".css"].includes(extname(path)))
  .map((path) => ({
    file: relative(staticDir, path).replaceAll("\\", "/"),
    type: extname(path) === ".css" ? "css" : "js",
    gzipBytes: gzipSync(readFileSync(path)).length,
  }));
const fonts = files.filter((path) => FONT_EXTENSIONS.has(extname(path)));

const kb = (bytes) => bytes / 1024;
const sum = (items) => items.reduce((total, item) => total + item.gzipBytes, 0);
const js = assets.filter((asset) => asset.type === "js");
const css = assets.filter((asset) => asset.type === "css");
const largest = [...js].sort((a, b) => b.gzipBytes - a.gzipBytes)[0];

const checks = [
  ["total client JS (gzip)", kb(sum(js)), "totalJsGzipKB"],
  [
    "largest JS chunk (gzip)",
    kb(largest?.gzipBytes ?? 0),
    "largestJsChunkGzipKB",
  ],
  ["total CSS (gzip)", kb(sum(css)), "totalCssGzipKB"],
];
if (budget.totalFontKB !== undefined) {
  checks.push([
    `fonts on disk (${fonts.length} files)`,
    kb(fonts.reduce((total, path) => total + statSync(path).size, 0)),
    "totalFontKB",
  ]);
}

let failed = false;
if (budget.entryHtml) {
  // Vite SPA: the entry script plus its modulepreloads is the first load.
  const html = readFileSync(join(rootDir, budget.entryHtml), "utf8");
  const names = entryScripts(html).map((url) => url.split("/").pop());
  const entry = js.filter((asset) => names.includes(asset.file));
  if (entry.length === 0 || entry.length !== names.length) {
    console.error(
      `  FAIL ${budget.entryHtml} references ${names.length} script(s), ${entry.length} found in ${budget.staticDir}`,
    );
    failed = true;
  }
  checks.push(["entry JS, first load (gzip)", kb(sum(entry)), "entryJsGzipKB"]);
}

console.log(
  `Client bundle budget (${relative(process.cwd(), rootDir) || "."})`,
);
for (const [label, actual, key] of checks) {
  const limit = budget[key];
  measured.set(key, actual);
  const status = budgetStatus(actual, limit);
  failed ||= status === "fail";
  console.log(
    `  ${STATUS_LABEL[status]} ${label.padEnd(28)} ${actual.toFixed(1).padStart(7)} KB / ${limit} KB`,
  );
}

// ---- per-module first-load budgets (Next.js projects) --------------------
if (budget.modules || budget.shell) {
  checkRoutes();
}

function checkRoutes() {
  const gzipByPath = new Map();
  const chunkFile = (chunk) => join(rootDir, chunk.replaceAll("\\", "/"));
  function chunkGzip(chunk) {
    const file = chunkFile(chunk);
    if (!gzipByPath.has(file)) {
      gzipByPath.set(file, gzipSync(readFileSync(file)).length);
    }
    return gzipByPath.get(file);
  }

  let routeStats = [];
  try {
    routeStats = JSON.parse(
      readFileSync(
        join(rootDir, ".next", "diagnostics", "route-bundle-stats.json"),
        "utf8",
      ),
    );
  } catch {
    console.error(
      "  FAIL no .next/diagnostics/route-bundle-stats.json (needs next build).",
    );
    failed = true;
  }

  const scripts = (route) =>
    route.firstLoadChunkPaths.filter((chunk) => chunk.endsWith(".js"));
  const firstLoadKB = (route) =>
    kb(scripts(route).reduce((total, chunk) => total + chunkGzip(chunk), 0));
  const underPrefix = (route, prefix) =>
    route === prefix || route.startsWith(`${prefix}/`);
  const owners = [
    ...Object.entries(budget.modules ?? {}).map(([id, entry]) => ({
      id,
      prefix: entry.routePrefix,
      limit: entry.firstLoadGzipKB,
    })),
    ...Object.entries(budget.shell ?? {}).map(([route, limit]) => ({
      id: "shell",
      prefix: route,
      limit,
      exact: true,
    })),
  ];

  console.log("Per-module first-load JS (heaviest route, gzip)");
  const worst = new Map();
  for (const route of routeStats) {
    const owner = owners.find((o) =>
      o.exact ? o.prefix === route.route : underPrefix(route.route, o.prefix),
    );
    if (!owner) {
      console.log(
        `  FAIL ${route.route} has no module/shell budget in bundle-budget.json`,
      );
      failed = true;
      continue;
    }
    const size = firstLoadKB(route);
    const key = owner.exact ? `shell ${owner.prefix}` : owner.id;
    if (size > (worst.get(key)?.size ?? 0)) {
      worst.set(key, {
        size,
        limit: owner.limit,
        route: route.route,
        limitKey: owner.exact ? `shell.${owner.prefix}` : `modules.${owner.id}`,
      });
    }
    for (const chunk of scripts(route)) {
      if (containsReplayRecorder(readFileSync(chunkFile(chunk), "utf8"))) {
        console.log(
          `  FAIL ${route.route} loads the Sentry Replay recorder in its first load (${chunk})`,
        );
        failed = true;
      }
    }
  }
  // A budget line whose route no longer exists is dead weight that hides the
  // next route added under that prefix.
  for (const owner of owners) {
    const key = owner.exact ? `shell ${owner.prefix}` : owner.id;
    if (routeStats.length > 0 && !worst.has(key)) {
      console.log(
        `  FAIL budget "${key}" (${owner.prefix}) matches no built route: remove it`,
      );
      failed = true;
    }
  }
  for (const [key, { size, limit, route, limitKey }] of worst) {
    measured.set(limitKey, size);
    const status = budgetStatus(size, limit);
    failed ||= status === "fail";
    console.log(
      `  ${STATUS_LABEL[status]} ${key.padEnd(28)} ${size.toFixed(1).padStart(7)} KB / ${limit} KB  (${route})`,
    );
  }
}

if (largest) {
  console.log(`  (largest chunk: ${largest.file})`);
}

// ---- ratchet: a limit only goes up with a recorded reason ----------------
const ratchet = baseBudget(budgetPath);
if ("notice" in ratchet) {
  console.log(`Budget ratchet: ${ratchet.notice}`);
} else {
  const problems = unjustifiedRaises(ratchet.base, budget);
  console.log(
    problems.length === 0
      ? "Budget ratchet: ok (no limit above the merge-base with origin/main without an increases entry)"
      : "Budget ratchet",
  );
  for (const problem of problems) {
    console.log(
      `  FAIL ${problem.limit} raised ${problem.old} -> ${problem.new}: ${problem.why}`,
    );
    failed = true;
  }
}

function limitOf(key) {
  if (key.startsWith("modules.")) {
    return budget.modules?.[key.slice("modules.".length)]?.firstLoadGzipKB;
  }
  if (key.startsWith("shell.")) {
    return budget.shell?.[key.slice("shell.".length)];
  }
  return budget[key];
}

const hints = [...measured]
  .map(([key, actual]) => {
    const limit = limitOf(key);
    return { key, actual, limit, to: lowerableTo(actual, limit) };
  })
  .filter((hint) => hint.to !== null);
if (hints.length > 0) {
  console.log("Limits more than 5 % above measured usage (ratchet them down):");
  for (const { key, actual, limit, to } of hints) {
    console.log(
      `  hint ${key}: ${actual.toFixed(1)} KB used of ${limit} KB, can be lowered to ${to}`,
    );
  }
}

if (failed) {
  console.error(
    "\nBudget exceeded. Find what grew (diff the chunk list or analyze the build) and " +
      "lazy-load it or drop it. Budgets are ratchets: raise a limit only together with an " +
      "`increases` entry { date, limit, old, new, reason } in bundle-budget.json " +
      "(and a row in docs/content/decisions/web.md for a decision).",
  );
  process.exit(1);
}

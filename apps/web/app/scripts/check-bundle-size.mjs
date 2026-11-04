#!/usr/bin/env node
// Performance budget for the client bundle. Run after `next build`:
//
//   pnpm check:bundle
//
// Sums the gzip size of every emitted client JS and CSS asset under
// `.next/static` and fails when a budget in `bundle-budget.json` is exceeded,
// so a dependency or import that quietly adds 100 KB shows up as a red CI
// check on the pull request that introduced it — not as a Lighthouse
// regression weeks later. (Core Web Vitals budgets live in `lighthouserc.json`.)
//
// Besides the global ceilings it enforces PER-MODULE first-load budgets: the
// gzip JS a visitor downloads for the heaviest route of each feature module
// (`modules.<id>.routePrefix` + `firstLoadGzipKB` in bundle-budget.json), read
// from Next's `.next/diagnostics/route-bundle-stats.json`. Every route must
// belong to a budgeted module or the `shell` list, so a new module cannot ship
// without a budget. A module that grows shows up under its own name.
//
// Any budget at 95 % or more of its limit prints WARN (the build still passes).
//
// Uses only node built-ins: no new dependency for a 60-line script.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  budgetStatus,
  containsReplayRecorder,
  STATUS_LABEL,
} from "./bundle-status.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const staticDir = join(rootDir, ".next", "static");
const budget = JSON.parse(
  readFileSync(join(rootDir, "bundle-budget.json"), "utf8"),
);

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

let assets;
try {
  assets = [...walk(staticDir)]
    .filter((path) => [".js", ".css"].includes(extname(path)))
    .map((path) => ({
      file: relative(staticDir, path).replaceAll("\\", "/"),
      type: extname(path) === ".css" ? "css" : "js",
      gzipBytes: gzipSync(readFileSync(path)).length,
    }));
} catch {
  console.error("No build output found — run `pnpm build` first.");
  process.exit(2);
}

const kb = (bytes) => bytes / 1024;
const sum = (items) => items.reduce((total, item) => total + item.gzipBytes, 0);
const js = assets.filter((asset) => asset.type === "js");
const css = assets.filter((asset) => asset.type === "css");
const largest = [...js].sort((a, b) => b.gzipBytes - a.gzipBytes)[0];

const checks = [
  ["total client JS (gzip)", kb(sum(js)), budget.totalJsGzipKB],
  [
    "largest JS chunk (gzip)",
    kb(largest?.gzipBytes ?? 0),
    budget.largestJsChunkGzipKB,
  ],
  ["total CSS (gzip)", kb(sum(css)), budget.totalCssGzipKB],
];

let failed = false;
console.log("Client bundle budget");
for (const [label, actual, limit] of checks) {
  const status = budgetStatus(actual, limit);
  failed ||= status === "fail";
  console.log(
    `  ${STATUS_LABEL[status]} ${label.padEnd(26)} ${actual.toFixed(1).padStart(7)} KB / ${limit} KB`,
  );
}
// ---- per-module first-load budgets ---------------------------------------
const gzipByPath = new Map();
function chunkGzip(chunkPath) {
  const file = join(rootDir, chunkPath.replaceAll("\\", "/"));
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

const firstLoadKB = (route) =>
  kb(
    route.firstLoadChunkPaths
      .filter((chunk) => chunk.endsWith(".js"))
      .reduce((total, chunk) => total + chunkGzip(chunk), 0),
  );
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
    worst.set(key, { size, limit: owner.limit, route: route.route });
  }
}
for (const route of routeStats) {
  for (const chunk of route.firstLoadChunkPaths.filter((c) =>
    c.endsWith(".js"),
  )) {
    const source = readFileSync(
      join(rootDir, chunk.replaceAll("\\", "/")),
      "utf8",
    );
    if (containsReplayRecorder(source)) {
      console.log(
        `  FAIL ${route.route} loads the Sentry Replay recorder in its first load (${chunk})`,
      );
      failed = true;
    }
  }
}
for (const [key, { size, limit, route }] of worst) {
  const status = budgetStatus(size, limit);
  failed ||= status === "fail";
  console.log(
    `  ${STATUS_LABEL[status]} ${key.padEnd(26)} ${size.toFixed(1).padStart(7)} KB / ${limit} KB  (${route})`,
  );
}

if (largest) {
  console.log(`  (largest chunk: ${largest.file})`);
}

if (failed) {
  console.error(
    "\nBudget exceeded. Find what grew (e.g. `ANALYZE` a build or diff the chunk list), " +
      "lazy-load it with next/dynamic, or — if the growth is intended — raise " +
      "bundle-budget.json in the same PR with the reason in the description.",
  );
  process.exit(1);
}

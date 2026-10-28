#!/usr/bin/env node
// File-size policy for hand-written web source. Run with:
//
//   pnpm check:file-size
//
//   <= 300 lines   green   fine
//   301-400        yellow  warning: consider splitting
//   401-500        orange  high warning: split soon
//   > 500          red     FAILS the check (exit 1)
//
// Excludes generated code (`generated/`, `*_pb.ts`, `validate_pb`), the
// design-token output (`tokens.css`), vendored/build output and coverage.
// Biome's `style/noExcessiveLinesPerFile` (biome.json) enforces the same hard
// limit in the editor; this script adds the warning tiers Biome cannot
// express (one threshold, one severity).
//
// Uses only node built-ins.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const YELLOW_FROM = 301;
const HIGH_FROM = 401;
const RED_FROM = 501;

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".mjs",
  ".js",
  ".jsx",
  ".css",
]);
const SKIPPED_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  "playwright-report",
  "test-results",
  "storybook-static",
  ".lighthouseci",
  "generated",
  "__screenshots__",
  ".vitest-attachments",
]);
const SKIPPED_FILE = /(_pb\.ts|validate_pb\.ts|tokens\.css|\.d\.ts)$/;

const useColor = process.stdout.isTTY || process.env.FORCE_COLOR;
const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const green = (t) => paint(32, t);
const yellow = (t) => paint(33, t);
const orange = (t) => paint("38;5;208", t);
const red = (t) => paint(31, t);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else if (
      SOURCE_EXTENSIONS.has(extname(path)) &&
      !SKIPPED_FILE.test(path)
    ) {
      yield path;
    }
  }
}

function countLines(path) {
  const text = readFileSync(path, "utf8");
  if (text.length === 0) {
    return 0;
  }
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

const files = [...walk(rootDir)].map((path) => ({
  path: relative(rootDir, path).split(sep).join("/"),
  lines: countLines(path),
}));

const yellowFiles = files.filter(
  (f) => f.lines >= YELLOW_FROM && f.lines < HIGH_FROM,
);
const highFiles = files.filter(
  (f) => f.lines >= HIGH_FROM && f.lines < RED_FROM,
);
const redFiles = files.filter((f) => f.lines >= RED_FROM);
const byLines = (a, b) => b.lines - a.lines;

for (const f of yellowFiles.sort(byLines)) {
  console.log(`${yellow("warn   ")} ${f.lines} lines  ${f.path}`);
}
for (const f of highFiles.sort(byLines)) {
  console.log(`${orange("HIGH   ")} ${f.lines} lines  ${f.path}`);
}
for (const f of redFiles.sort(byLines)) {
  console.log(`${red("ERROR  ")} ${f.lines} lines  ${f.path}`);
}

const summary = `${files.length} files: ${yellowFiles.length} over ${YELLOW_FROM - 1} (warn), ${highFiles.length} over ${HIGH_FROM - 1} (high), ${redFiles.length} over ${RED_FROM - 1} (error)`;
if (redFiles.length > 0) {
  console.error(red(`File-size policy FAILED: ${summary}`));
  console.error(
    "Split files over 500 lines into cohesive modules (see docs: file-size policy).",
  );
  process.exit(1);
}
console.log(green(`File-size policy OK: ${summary}`));

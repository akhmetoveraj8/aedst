#!/usr/bin/env node
// Two cheap source bans for ONE web project plus the shared kit. Run from the
// project directory (`pnpm check:source` in app, admin and landing), or pass
// the project directory as the first argument:
//
//   node ../shared/scripts/check-source-bans.mjs [project-dir]
//
// 1. Physical Tailwind utilities (`ml-4`, `pr-2`, `left-0`, `text-left`, ...).
//    Arabic is right-to-left: spacing, position and alignment must use the
//    logical utilities (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`,
//    `text-start`, `text-end`) so the layout mirrors with `dir`. Not flagged:
//    a utility behind an explicit direction or physical-side variant
//    (`rtl:`, `ltr:`, `data-[side=left]:`), because that is a deliberate
//    per-direction or per-side rule.
// 2. Base64 images (`data:image/...` literals). An inlined image is not
//    cached, not lazy and bloats the JS or CSS that carries it: use a file in
//    `public/` or an SVG component.
//
// Biome cannot express either (GritQL plugins match syntax nodes of one
// language, not class strings across ts, tsx and css), so it is a script,
// like check-color-literals.mjs. Tests, stories and generated code are not
// scanned. Justified exceptions go to source-bans-allowlist.json next to this
// file, each with a reason. Uses only node built-ins.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// AEDST_WEB_ROOT points the check at another tree (`pnpm check:selftest`).
const rootDir = resolve(
  process.env.AEDST_WEB_ROOT ?? process.argv[2] ?? process.cwd(),
);
const webDir = dirname(rootDir);

const EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
const SKIPPED_DIRS = new Set([
  "node_modules",
  "generated",
  "__screenshots__",
  "scripts",
]);
const SKIPPED_FILES = /\.(?:test|stories|test-support)\.[a-z]+$|\.gen\.ts$/;

const VARIANTS = String.raw`((?:[a-z0-9-]*(?:\[[^\]]*\])?[a-z0-9-]*:)*)`;
const VALUE = String.raw`(?:\[[^\]]+\]|\d[\w./]*|px|auto|full|screen)`;
const PHYSICAL = new RegExp(
  String.raw`(?<![\w-])${VARIANTS}(-?(?:ml|mr|pl|pr|left|right)-${VALUE}|text-(?:left|right))(?![\w-])`,
  "g",
);
const DIRECTION_VARIANT = /(?:^|:)(?:rtl|ltr):|\[side=(?:left|right)\]/;
const LOGICAL = {
  ml: "ms",
  mr: "me",
  pl: "ps",
  pr: "pe",
  left: "start",
  right: "end",
};
const DATA_IMAGE = /data:image\//g;

/** @type {{ file: string, match: string, reason: string }[]} */
const allowlist = JSON.parse(
  readFileSync(join(scriptDir, "source-bans-allowlist.json"), "utf8"),
).allow;

function* walk(dir) {
  if (!existsSync(dir)) {
    return;
  }
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else if (EXTENSIONS.has(extname(path)) && !SKIPPED_FILES.test(entry)) {
      yield path;
    }
  }
}

const isCommentLine = (line) => /^\s*(?:\/\/|\/\*|\*)/.test(line);

function logicalName(utility) {
  if (utility.startsWith("text-")) {
    return utility.replace("left", "start").replace("right", "end");
  }
  return utility.replace(
    /^(-?)(ml|mr|pl|pr|left|right)-/,
    (_, sign, name) => `${sign}${LOGICAL[name]}-`,
  );
}

function findings(text) {
  const out = [];
  text.split("\n").forEach((line, index) => {
    if (isCommentLine(line)) {
      return;
    }
    for (const match of line.matchAll(PHYSICAL)) {
      if (!DIRECTION_VARIANT.test(match[1])) {
        out.push({
          line: index + 1,
          match: match[0],
          hint: `use ${match[1]}${logicalName(match[2])}`,
        });
      }
    }
    for (const match of line.matchAll(DATA_IMAGE)) {
      out.push({
        line: index + 1,
        match: match[0],
        hint: "Base64 image: use a file in public/ or an SVG component",
      });
    }
  });
  return out;
}

const allowed = (file, match) =>
  allowlist.some(
    (entry) => entry.file === file && entry.match === match && entry.reason,
  );

const offenders = [];
// shared/ is a sibling of the project; files are reported relative to apps/web.
for (const path of [
  ...walk(join(rootDir, "src")),
  ...walk(join(webDir, "shared")),
]) {
  const file = relative(webDir, path).split(sep).join("/");
  for (const found of findings(readFileSync(path, "utf8"))) {
    if (!allowed(file, found.match)) {
      offenders.push({ file, ...found });
    }
  }
}

if (offenders.length > 0) {
  console.error(
    "Banned source patterns found (physical direction utilities break right-to-left; Base64 images bloat bundles):\n",
  );
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  ${o.match}  -> ${o.hint}`);
  }
  console.error(
    `\n${offenders.length} offender(s). A justified case goes to apps/web/shared/scripts/source-bans-allowlist.json with a reason.`,
  );
  process.exit(1);
}
console.log(
  `Source bans OK: no physical direction utilities, no Base64 images (${allowlist.length} allowlisted).`,
);

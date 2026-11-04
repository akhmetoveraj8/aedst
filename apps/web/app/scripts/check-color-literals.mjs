#!/usr/bin/env node
// Hardcoded-color ban. Run with:
//
//   pnpm check:colors
//
// Fails on hex (#rgb, #rrggbb, ...), rgb()/rgba(), hsl()/hsla() and oklch()
// color literals in src/**/*.{ts,tsx,css}. Colors come from the design
// tokens (packages/design-tokens -> ../shared/ui/tokens.css) and are used
// through CSS variables / Tailwind utilities (`bg-primary`, `var(--border)`),
// so a theme change or dark mode never needs a code edit.
//
// Biome cannot express this (GritQL plugins match syntax nodes of one
// language, not string contents across ts, tsx and css), so it is a script.
//
// Also fails on Tailwind default-palette utilities (bg-red-500, text-neutral-600,
// ring-blue-400, ...) outside src/shared/ui: they are literal colors in disguise
// (no theme, no dark mode). Use token utilities (bg-destructive, text-muted-foreground)
// or a Badge variant (success, warning, info).
//
// Not flagged:
//  - relative/derived colors built on tokens: `oklch(from var(--primary) ...)`,
//    `color-mix(in oklch, var(--x), ...)`
//  - Recharts default-attribute selectors such as `[stroke='#ccc']`, which
//    match the library's own output and never apply a color
//  - comment lines
//
// Uses only node built-ins.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// AEDST_WEB_ROOT points the check at another tree (`pnpm check:selftest`).
const rootDir =
  process.env.AEDST_WEB_ROOT ??
  dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(rootDir, "src");

/**
 * Files that legitimately contain literal colors. Every entry needs a reason;
 * keep this list short and never add a component here.
 */
const ALLOWED_FILES = new Map([
  [
    "src/app/styles/globals.css",
    "@theme re-declares the white/black/red-700 utilities after the Tailwind palette reset",
  ],
  [
    "../shared/ui/tokens.css",
    "generated from packages/design-tokens - the single source of every color",
  ],
  [
    "src/app/(pages)/[locale]/opengraph-image.tsx",
    "rendered by satori (ImageResponse): no CSS variables or stylesheet there",
  ],
  [
    "src/app/icons/[file]/route.tsx",
    "rendered by satori (ImageResponse): no CSS variables or stylesheet there",
  ],
  [
    "src/app/config/pwa/offline-page.ts",
    "standalone offline document served without the app stylesheet or JS",
  ],
  [
    "src/app/config/seo.ts",
    "themeColor feeds <meta name=theme-color>/the manifest: browser chrome needs literal colors",
  ],
]);

const EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
const SKIPPED_DIRS = new Set(["node_modules", "generated", "__screenshots__"]);

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
// `oklch(from ...)` is a relative color on a token; only numeric literals count.
const FUNCTIONAL =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab)\(|\boklch\(\s*(?:[0-9.]|none\b|-)/g;
const PALETTE =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|outline|divide|decoration|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
const PALETTE_EXEMPT_PREFIX = "../shared/ui/"; // shadcn primitives, reviewed with the kit
const LIBRARY_ATTRIBUTE_SELECTOR = /\[(?:stroke|fill)=['"]$/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else if (EXTENSIONS.has(extname(path))) {
      yield path;
    }
  }
}

const isCommentLine = (line) => /^\s*(?:\/\/|\/\*|\*)/.test(line);

function findings(text, relPath) {
  const out = [];
  text.split("\n").forEach((line, index) => {
    if (isCommentLine(line)) {
      return;
    }
    const patterns = relPath.startsWith(PALETTE_EXEMPT_PREFIX)
      ? [HEX, FUNCTIONAL]
      : [HEX, FUNCTIONAL, PALETTE];
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) {
        if (LIBRARY_ATTRIBUTE_SELECTOR.test(line.slice(0, match.index))) {
          continue;
        }
        out.push({ line: index + 1, text: match[0].trim() });
      }
    }
  });
  return out;
}

const offenders = [];
// shared/ is a sibling of the project; scan it too (paths show as ../shared/...).
for (const path of [...walk(srcDir), ...walk(join(rootDir, "..", "shared"))]) {
  const relPath = relative(rootDir, path).split(sep).join("/");
  if (ALLOWED_FILES.has(relPath)) {
    continue;
  }
  for (const found of findings(readFileSync(path, "utf8"), relPath)) {
    offenders.push({ file: relPath, ...found });
  }
}

if (offenders.length > 0) {
  console.error(
    "Hardcoded color literals found. Use a design token (CSS variable / Tailwind utility) instead:\n",
  );
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  ${o.text}`);
  }
  console.error(
    `\n${offenders.length} offender(s). If a file genuinely cannot use tokens (satori, standalone documents), add it to ALLOWED_FILES in scripts/check-color-literals.mjs with a reason.`,
  );
  process.exit(1);
}
console.log(
  `Color literals OK (${ALLOWED_FILES.size} allowlisted files, each with a documented reason).`,
);

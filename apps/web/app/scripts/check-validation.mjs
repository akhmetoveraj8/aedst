#!/usr/bin/env node
// Validation boundary gate for apps/web. Run with:
//
//   pnpm check:validation
//
// Rule page: docs/content/web/validation.md. The import and register() rules
// are Biome plugins (app/lint/no-*.grit); this script covers what Biome cannot
// express (a property of the whole file):
//
//   1. a file that uses protovalidateResolver must not import Zod or use
//      standardSchemaResolver (one rule source per form, never both);
//   2. every `useForm(` call passes a `resolver:` (React Hook Form is state
//      only; without a resolver the form has no rules at all, and the
//      alternative is inline rules, which are banned);
//   3. no hand-written validation helpers (`validateX`, `isValidX`, `isEmail`,
//      `*_REGEX`, `*_PATTERN`) outside the places that own validation, since
//      they duplicate a proto rule.
//
// An exception is a documented entry in ALLOWLIST (file, rule, reason), never
// a comment in the code. Walks app, admin, landing and shared. Test files,
// stories and generated code are skipped. Uses only node built-ins.
// AEDST_WEB_ROOT points it at another tree (`pnpm check:selftest`).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir =
  process.env.AEDST_WEB_ROOT ??
  dirname(dirname(fileURLToPath(import.meta.url)));
const webDir = join(rootDir, "..");

/** `file` is relative to apps/web; `rule` is 1, 2 or 3 (see above). */
const ALLOWLIST = [];

const SKIPPED = /(?:\.test\.tsx?|\.stories\.tsx|\.d\.ts)$/;
const SKIPPED_DIRS = new Set(["node_modules", "generated", "test", ".next"]);
// Places that own validation: the resolver seam, env schemas, auth/OIDC
// protocol checks (RFC-defined, not product rules).
const OWNERS = [
  /^shared\/lib\/forms\//,
  /^shared\/env\//,
  /^shared\/lib\/auth\//,
  /(?:^|\/)env\.ts$/,
  /\/app\/config\//,
];

const ZOD_IMPORT = /from\s+["']zod(?:\/[\w-]+)?["']/;
const PV_RESOLVER = /\bprotovalidateResolver\b/;
const SCHEMA_RESOLVER = /\bstandardSchemaResolver\b/;
const USE_FORM = /\buseForm\s*(?:<[^>(]*>)?\s*\(/g;
const HELPER =
  /\b(?:function\s+|const\s+|let\s+)(validate[A-Z]\w*|isValid[A-Z]\w*|isEmail\w*|isPhone\w*|isUrl\w*|is[A-Z]\w*Valid)\b|\b(?:const|let)\s+([A-Z][A-Z0-9_]*(?:REGEX|PATTERN|_RE))\b/;

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
    } else if (/\.tsx?$/.test(path) && !SKIPPED.test(path)) {
      yield path;
    }
  }
}

// Balanced-paren scan: the text of the argument list that starts at `open`.
function callArguments(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") {
      depth++;
    } else if (text[i] === ")" && --depth === 0) {
      return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

const allowed = (file, rule) =>
  ALLOWLIST.some((entry) => entry.file === file && entry.rule === rule);

const roots = [
  join(rootDir, "src"),
  join(webDir, "shared"),
  join(webDir, "admin", "src"),
  join(webDir, "landing", "src"),
];
const seen = new Set();
const offenders = [];
for (const root of roots) {
  for (const path of walk(root)) {
    const file = relative(webDir, path).split(sep).join("/");
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const text = readFileSync(path, "utf8");
    const owner = OWNERS.some((pattern) => pattern.test(file));

    if (
      !owner &&
      SCHEMA_RESOLVER.test(text) &&
      PV_RESOLVER.test(text) &&
      !allowed(file, 1)
    ) {
      offenders.push(
        `${file}: uses both standardSchemaResolver and protovalidateResolver (rule 1: one rule source per form; an API-message form uses protovalidateResolver, a client-only form uses a Zod schema)`,
      );
    }

    if (
      !owner &&
      ZOD_IMPORT.test(text) &&
      PV_RESOLVER.test(text) &&
      !allowed(file, 1)
    ) {
      offenders.push(
        `${file}: imports Zod and uses protovalidateResolver (rule 1: one rule source per form; move the Zod schema out of the form file, or drop it)`,
      );
    }

    if (file !== "shared/ui/form.tsx" && !owner) {
      for (const match of text.matchAll(USE_FORM)) {
        const args = callArguments(text, match.index + match[0].length - 1);
        if (!/\bresolver\s*[:,}]/.test(args) && !allowed(file, 2)) {
          offenders.push(
            `${file}: useForm() without resolver (rule 2: pass protovalidateResolver; React Hook Form holds state, not rules)`,
          );
        }
      }
    }

    if (!owner) {
      const helper = HELPER.exec(text);
      if (helper && !allowed(file, 3)) {
        offenders.push(
          `${file}: hand-written validator "${helper[1] ?? helper[2]}" (rule 3: the rule belongs in the .proto, or in a Zod schema for client-only data)`,
        );
      }
    }
  }
}

if (offenders.length > 0) {
  console.error(
    "Validation boundary violated (docs/content/web/validation.md):\n",
  );
  for (const line of offenders) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}
console.log(
  "Validation boundary OK (no Zod+Protovalidate mix, every useForm has a resolver, no ad-hoc validators).",
);

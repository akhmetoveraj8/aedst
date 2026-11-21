#!/usr/bin/env node
// Forms use React Hook Form. Run with:
//
//   pnpm check:forms
//
// Fails when a .tsx file under src renders a form (`<form` or the shared/ui
// `<Form`) without importing `react-hook-form`: a form that keeps its state
// in useState/FormData by hand is a second form library. Test files and
// stories are skipped; `src/shared/ui/form.tsx` is the one place that owns
// the raw `<form>` element (Biome `noRestrictedElements` bans it elsewhere).
//
// Biome cannot express "this file contains X but not import Y", hence a
// script. Uses only node built-ins. AEDST_WEB_ROOT points it at another tree
// (`pnpm check:selftest`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir =
  process.env.AEDST_WEB_ROOT ??
  dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(rootDir, "src");

const FORM_ELEMENT = /<(?:form|Form)[\s>/]/;
const RHF_IMPORT = /from\s+["']react-hook-form["']/;
const SKIPPED = /(?:\.test\.tsx|\.stories\.tsx)$/;
const OWNER = "../shared/ui/form.tsx";

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "generated") {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else if (path.endsWith(".tsx") && !SKIPPED.test(path)) {
      yield path;
    }
  }
}

const offenders = [];
for (const path of [...walk(srcDir), ...walk(join(rootDir, "..", "shared"))]) {
  const relPath = relative(rootDir, path).split(sep).join("/");
  if (relPath === OWNER) {
    continue;
  }
  const text = readFileSync(path, "utf8");
  if (FORM_ELEMENT.test(text) && !RHF_IMPORT.test(text)) {
    offenders.push(relPath);
  }
}

if (offenders.length > 0) {
  console.error(
    "A form must use React Hook Form (useForm + protovalidateResolver, see modules/tasks/ui/task-form.tsx). These files render a form without importing react-hook-form:\n",
  );
  for (const file of offenders) {
    console.error(`  ${file}`);
  }
  process.exit(1);
}
console.log(
  "Forms OK (every file that renders a form imports react-hook-form).",
);

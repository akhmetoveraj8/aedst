#!/usr/bin/env node
// Generates docs/content/api/<module>.md from apps/server/api/proto. Usage:
//   node scripts/api-docs/index.mjs           write the pages
//   node scripts/api-docs/index.mjs --check   exit 1 when a committed page is stale
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProto } from "./parse-proto.mjs";
import { renderModule } from "./render.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const protoRoot = join(root, "apps/server/api/proto/aedst");
const outDir = join(root, "docs/content/api");

export function generate() {
  const pages = new Map();
  for (const module of readdirSync(protoRoot).sort()) {
    const dir = join(protoRoot, module, "v1");
    if (!existsSync(dir)) continue;
    const names = readdirSync(dir).filter((n) => n.endsWith(".proto")).sort();
    const files = names.map((n) => parseProto(readFileSync(join(dir, n), "utf8")));
    pages.set(`${module}.md`, renderModule(module, files, `apps/server/api/proto/aedst/${module}/v1/`));
  }
  return pages;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pages = generate();
  const stale = [];
  for (const [name, text] of pages) {
    const path = join(outDir, name);
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === text) continue;
    stale.push(name);
    if (!process.argv.includes("--check")) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path, text);
    }
  }
  if (process.argv.includes("--check") && stale.length) {
    console.error(`stale API pages: ${stale.join(", ")} (run: task docs:api)`);
    process.exit(1);
  }
  console.log(`${pages.size} API pages ${process.argv.includes("--check") ? "up to date" : `written (${stale.length} changed)`}`);
}

#!/usr/bin/env node
// Generates the API reference pages from the Protobuf contract. The input is buf's descriptor
// set (`buf build -o -#format=json` in apps/server), never the .proto text. Output:
//   docs/content/modules/<module>/api.md   one page per module package
//   docs/content/api/<package>.md          packages owned by the platform, not a module
//   docs/content/modules/<module>/events.md  event payload contracts (aedst.<module>.events.v1)
// Usage:
//   node scripts/api-docs/index.mjs           write the pages
//   node scripts/api-docs/index.mjs --check   exit 1 when a committed page is stale
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { filesByPackage, loadDescriptorSet } from "./descriptor.mjs";
import { renderModule } from "./render.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Proto packages served by platform code (apps/server/internal/platform), which has no module section.
export const PLATFORM_PACKAGES = new Set(["events"]);

export const pagePath = (module) =>
  PLATFORM_PACKAGES.has(module) ? `docs/content/api/${module}.md` : `docs/content/modules/${module}/api.md`;

// The interactive OpenAPI page of a package (written by docs/scripts/openapi-pages.mjs), next to its reference page.
export const openapiPagePath = (module) =>
  PLATFORM_PACKAGES.has(module) ? `docs/content/api/${module}-openapi.mdx` : `docs/content/modules/${module}/openapi.mdx`;

// Site route of a docs/content page path.
export const routeOf = (page) => page.replace(/^docs\/content/, "").replace(/\.mdx?$/, "");

// descriptor set -> Map<repo-relative page path, Markdown>
export function generate(set) {
  const pages = new Map();
  for (const [pkg, files] of filesByPackage(set)) {
    const [, module, third] = pkg.split(".");
    const repoPath = `apps/server/api/proto/${dirname(files[0].name)}/`;
    if (third === "events") {
      // aedst.<module>.events.v<N>: messages only, the payloads of the module's integration events.
      pages.set(`docs/content/modules/${module}/events.md`, renderModule(module, files, repoPath, { overview: "/server/events", openapi: "" }, "events"));
      continue;
    }
    pages.set(pagePath(module), renderModule(module, files, repoPath, { overview: "/api", openapi: `/openapi/aedst.${module}.${third}.yaml`, interactive: routeOf(openapiPagePath(module)) }));
  }
  return pages;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const pages = generate(loadDescriptorSet(join(root, "apps/server")));
  const stale = [];
  for (const [name, text] of pages) {
    const path = join(root, name);
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === text) continue;
    stale.push(name);
    if (!check) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
  }
  if (check && stale.length) {
    console.error(`stale API pages: ${stale.join(", ")} (run: task docs:api)`);
    process.exit(1);
  }
  console.log(`${pages.size} API pages ${check ? "up to date" : `written (${stale.length} changed)`}`);
}

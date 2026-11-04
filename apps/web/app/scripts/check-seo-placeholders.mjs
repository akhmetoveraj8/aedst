#!/usr/bin/env node
// Production-build guard: fails when the template's SEO placeholders are
// still in place. Run as `prebuild` (see package.json); it only enforces
// when AEDST_REQUIRE_REAL_SEO=1, so local `next build` and the template's
// own CI/e2e builds are untouched. Set the variable in the release build.
//
//   AEDST_REQUIRE_REAL_SEO=1 NEXT_PUBLIC_SITE_URL=https://example.com node scripts/check-seo-placeholders.mjs
//
// Checks: NEXT_PUBLIC_SITE_URL is not localhost/127.0.0.1/[::1], and neither
// `siteConfig.description` (src/app/config/seo.ts) nor `common.appDescription`
// in the English catalogue still contains template copy.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PLACEHOLDER_PHRASES = ["AEDST stack", "task manager"];

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

/** Pure: returns a list of human-readable problems (empty = fine). */
export function findProblems({ siteUrl, descriptions }) {
  const problems = [];
  let host = "";
  try {
    host = new URL(siteUrl).hostname;
  } catch {
    problems.push(`NEXT_PUBLIC_SITE_URL is not a valid URL: "${siteUrl}"`);
  }
  if (host && (LOCAL_HOST.test(host) || host.endsWith(".localhost"))) {
    problems.push(
      `NEXT_PUBLIC_SITE_URL points at ${host}; set the real public origin`,
    );
  }
  for (const [where, text] of Object.entries(descriptions)) {
    for (const phrase of PLACEHOLDER_PHRASES) {
      if (text.toLowerCase().includes(phrase.toLowerCase())) {
        problems.push(`${where} still contains template copy "${phrase}"`);
      }
    }
  }
  return problems;
}

function readDescriptions(webDir) {
  const seo = readFileSync(join(webDir, "src/app/config/seo.ts"), "utf8");
  const catalogue = JSON.parse(
    readFileSync(join(webDir, "src/app/config/i18n/common/en.json"), "utf8"),
  );
  return {
    "siteConfig.description (src/app/config/seo.ts)":
      /description:\s*"([^"]*)"/.exec(seo)?.[1] ?? "",
    "common.appDescription (src/app/config/i18n/common/en.json)":
      catalogue.appDescription ?? "",
  };
}

function main() {
  if (process.env.AEDST_REQUIRE_REAL_SEO !== "1") {
    return 0;
  }
  const webDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const problems = findProblems({
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    descriptions: readDescriptions(webDir),
  });
  for (const problem of problems) {
    console.error(`seo-placeholders: ${problem}`);
  }
  if (problems.length > 0) {
    console.error(
      "See docs/content/web/seo-geo.md (first-clone checklist). Unset AEDST_REQUIRE_REAL_SEO to skip this check.",
    );
  }
  return problems.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}

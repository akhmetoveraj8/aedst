#!/usr/bin/env node
// Date control for the marketing site (feeds the sitemap `<lastmod>` and the
// "Last updated" line of the legal pages). Run as `pnpm check:dates`.
//
// Fails when:
//   - a `lastModified` in src/app/config/public-routes.ts is not a real
//     YYYY-MM-DD date, or lies in the future (crawlers distrust both);
//   - a legal page's "updated" line (src/modules/legal/i18n/<locale>.json) names
//     a different day, month or year than the `lastModified` of that page
//     (en is compared as a full date, the other locales by day and year).
// Uses only node built-ins.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const LOCALES = ["en", "ru", "tj", "uz", "ar"];
// Route pathname -> key of the legal catalogue that prints its date.
const LEGAL_KEYS = { privacy: "privacy", terms: "terms" };
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Pure: `YYYY-MM-DD` -> Date at UTC midnight, or null when not a real date. */
export function parseIsoDate(value) {
  const match = ISO_DATE.exec(value);
  if (!match) {
    return null;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

/** Pure: reads `pathname` and `lastModified` pairs out of the route table source. */
export function parseRoutes(source) {
  const routes = [];
  for (const block of source.split(/\n {2}\{/).slice(1)) {
    const pathname = /pathname:\s*"([^"]*)"/.exec(block)?.[1];
    const lastModified = /lastModified:\s*"([^"]*)"/.exec(block)?.[1];
    if (pathname !== undefined && lastModified !== undefined) {
      routes.push({ pathname, lastModified });
    }
  }
  return routes;
}

/** Pure: returns human-readable problems (empty = fine). */
export function findProblems({ routes, legal, today }) {
  const problems = [];
  if (routes.length === 0) {
    problems.push("no routes found in src/app/config/public-routes.ts");
  }
  for (const { pathname, lastModified } of routes) {
    const label = `route "${pathname || "/"}"`;
    const date = parseIsoDate(lastModified);
    if (!date) {
      problems.push(
        `${label}: lastModified "${lastModified}" is not a real YYYY-MM-DD date`,
      );
      continue;
    }
    if (date > today) {
      problems.push(`${label}: lastModified ${lastModified} is in the future`);
    }
    const key = LEGAL_KEYS[pathname];
    if (!key) {
      continue;
    }
    const [year, , day] = lastModified.split("-").map(Number);
    for (const locale of LOCALES) {
      const text = legal[locale]?.[key]?.updated;
      if (typeof text !== "string") {
        problems.push(
          `${label}: legal catalogue ${locale} has no ${key}.updated`,
        );
        continue;
      }
      const numbers = text.match(/\d+/g)?.map(Number) ?? [];
      if (!numbers.includes(year) || !numbers.includes(day)) {
        problems.push(
          `${label}: ${locale} "${text}" does not match lastModified ${lastModified}`,
        );
      }
    }
    const english = legal.en?.[key]?.updated;
    const expected = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
    if (typeof english === "string" && !english.includes(expected)) {
      problems.push(`${label}: en "${english}" should read "${expected}"`);
    }
  }
  return problems;
}

function main() {
  const routes = parseRoutes(
    readFileSync(join(root, "src/app/config/public-routes.ts"), "utf8"),
  );
  const legal = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      JSON.parse(
        readFileSync(
          join(root, `src/modules/legal/i18n/${locale}.json`),
          "utf8",
        ),
      ),
    ]),
  );
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const problems = findProblems({ routes, legal, today });
  for (const problem of problems) {
    console.error(`check-dates: ${problem}`);
  }
  if (problems.length === 0) {
    console.log(`check-dates OK: ${routes.length} routes.`);
  }
  return problems.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}

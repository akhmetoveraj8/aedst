#!/usr/bin/env node
// Apple-only i18n gates, imported by scripts/check-i18n-parity.mjs (so `task check:i18n` runs them) and runnable
// alone for the negative self-test:  node apps/apple/scripts/i18n-apple-checks.mjs --self-test
//
//  1. pluralMissing: a String Catalog localization whose value formats an integer (%lld, %d, %ld, %u, %1$lld ...)
//     must carry `variations.plural` (or a plural substitution). "1 tasks" is a bug in en and wrong in ru/ar/tg.
//  2. formatBan: `String(format: String(localized: ...), args)` (and the NSLocalizedString / localizedStringWithFormat
//     variants) is banned. It bypasses plural variations and argument-order handling of the catalog. Use the
//     interpolating initialiser with the catalog key `"key \(value)"` -> key `key %lld` / `key %@`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INT_SPEC = /%(?:\d+\$)?(?:l{1,2}|h{0,2}|z|q)?[dDiuU]/;
const FORMAT_BAN =
  /String\s*\(\s*format:\s*(?:String\s*\(\s*localized:|NSLocalizedString\s*\()|String\.localizedStringWithFormat\s*\(\s*(?:String\s*\(\s*localized:|NSLocalizedString\s*\()/;

/** @returns {{key: string, locale: string, detail: string}[]} */
export function applePluralIssues(catalog) {
  const issues = [];
  for (const [key, def] of Object.entries(catalog.strings ?? {})) {
    if (def.shouldTranslate === false) continue;
    for (const [locale, loc] of Object.entries(def.localizations ?? {})) {
      const hasPlural = JSON.stringify(loc.variations ?? {}).includes('"plural"') || JSON.stringify(loc.substitutions ?? {}).includes('"plural"');
      if (hasPlural) continue;
      const value = loc.stringUnit?.value;
      if (typeof value === 'string' && INT_SPEC.test(value)) {
        issues.push({ key, locale, detail: `"${value}" formats an integer without variations.plural` });
      }
    }
  }
  return issues;
}

/** @returns {{line: number, text: string}[]} line-level hits (comment-only lines are ignored) */
export function appleFormatBanIssues(source) {
  const hits = [];
  const lines = source.split('\n');
  // Join a call split over two lines so `String(format:\n String(localized:` is still caught.
  lines.forEach((text, i) => {
    if (/^\s*\/\//.test(text)) return;
    const joined = `${text} ${lines[i + 1] ?? ''}`;
    if (FORMAT_BAN.test(text) || (/String\s*\(\s*format:\s*$/.test(text) && FORMAT_BAN.test(joined))) {
      hits.push({ line: i + 1, text: text.trim().slice(0, 140) });
    }
  });
  return hits;
}

// ------------------------------------------------------------------ self-test
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--self-test')) {
    console.error('usage: node i18n-apple-checks.mjs --self-test (the gates run inside scripts/check-i18n-parity.mjs)');
    process.exit(2);
  }
  const fx = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'i18n');
  let ok = true;
  const expect = (cond, msg) => {
    if (!cond) { ok = false; console.error(`SELF-TEST FAIL: ${msg}`); }
  };
  const badCatalog = JSON.parse(readFileSync(path.join(fx, 'bad', 'Localizable.xcstrings.fixture'), 'utf8'));
  const goodCatalog = JSON.parse(readFileSync(path.join(fx, 'good', 'Localizable.xcstrings.fixture'), 'utf8'));
  const badKeys = new Set(applePluralIssues(badCatalog).map((i) => `${i.key}/${i.locale}`));
  for (const k of ['countNoPlural/en', 'countNoPlural/ru', 'positionalNoPlural/en', 'plainD/en']) expect(badKeys.has(k), `bad catalog did not flag ${k}`);
  expect(applePluralIssues(goodCatalog).length === 0, `good catalog flagged: ${JSON.stringify(applePluralIssues(goodCatalog))}`);
  const bad = readFileSync(path.join(fx, 'bad', 'BadFormat.swift.fixture'), 'utf8');
  const good = readFileSync(path.join(fx, 'good', 'GoodFormat.swift.fixture'), 'utf8');
  expect(appleFormatBanIssues(bad).length >= 4, `bad Swift fixture flagged ${appleFormatBanIssues(bad).length} < 4 forms`);
  expect(appleFormatBanIssues(good).length === 0, `good Swift fixture flagged: ${JSON.stringify(appleFormatBanIssues(good))}`);
  console.log(ok ? 'OK self-test: plural gate and String(format: String(localized:)) ban catch every bad fixture and pass the good ones.' : 'FAIL self-test');
  process.exit(ok ? 0 : 1);
}

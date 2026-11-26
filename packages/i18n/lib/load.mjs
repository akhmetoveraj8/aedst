// Loads and validates the shared translation files: <module>/<locale>.json under packages/i18n.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { argNames, parse, pluralOf } from './icu.mjs';
import { platformsOf, readTargets, targetErrors } from './targets.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOCALES = ['en', 'ru', 'tg', 'uz', 'ar'];

export function listModules() {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(root, d.name, 'en.json')))
    .map((d) => d.name)
    .sort();
}

/** Flatten nested JSON to `a.b.c` -> string; reports non-string leaves. */
export function flat(obj, prefix = '', out = {}, errors = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out, errors);
    else if (typeof v === 'string') out[key] = v;
    else errors.push(`${key}: value must be a string or an object`);
  }
  return out;
}

/** @returns {{ byLocale: Record<string, Record<string, any[]>>, enOrder: Record<string, string[]>, errors: string[] }} */
export function loadModule(mod) {
  const errors = [];
  const raw = {};
  for (const l of LOCALES) {
    const file = path.join(root, mod, `${l}.json`);
    if (!existsSync(file)) {
      errors.push(`${mod}/${l}.json: missing`);
      continue;
    }
    raw[l] = flat(JSON.parse(readFileSync(file, 'utf8')), '', {}, errors);
  }
  const targets = readTargets(mod);
  const byLocale = {};
  const enOrder = {};
  if (!raw.en) return { byLocale, enOrder, errors };
  for (const l of Object.keys(raw)) {
    byLocale[l] = {};
    for (const [key, src] of Object.entries(raw[l])) {
      try {
        byLocale[l][key] = parse(src);
        pluralOf(byLocale[l][key]);
      } catch (e) {
        errors.push(`${mod}/${l}.json ${key}: ${e.message}`);
      }
    }
  }
  for (const [key, segs] of Object.entries(byLocale.en)) enOrder[key] = argNames(segs);
  for (const l of LOCALES.filter((x) => x !== 'en' && byLocale[x])) {
    for (const key of Object.keys(byLocale.en)) {
      const segs = byLocale[l][key];
      if (!segs) {
        errors.push(`${mod}/${l}.json: missing key ${key}`);
        continue;
      }
      const got = argNames(segs);
      if (got.slice().sort().join() !== enOrder[key].slice().sort().join()) {
        errors.push(`${mod}/${l}.json ${key}: arguments {${got}} differ from en {${enOrder[key]}}`);
      } else if (got.join() !== enOrder[key].join() && platformsOf(targets, key).includes('desktop')) {
        errors.push(`${mod}/${l}.json ${key}: argument order {${got}} differs from en {${enOrder[key]}} (Desktop cannot reorder)`);
      }
    }
    for (const key of Object.keys(byLocale[l])) {
      if (!byLocale.en[key]) errors.push(`${mod}/${l}.json: extra key ${key}`);
    }
  }
  errors.push(...targetErrors(mod, targets, new Set(Object.keys(byLocale.en))));
  return { byLocale, enOrder, errors, targets };
}

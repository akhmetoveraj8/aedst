// Reads Apple String Catalogs (.xcstrings) and converts entries to the shared ICU subset (used by import-apple.mjs).
import { readFileSync } from 'node:fs';

/** @returns {Map<string, Map<string, {plural: boolean, text?: string, forms?: Record<string,string>}>>} name -> locale -> entry */
export function parseXcstrings(file) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const out = new Map();
  for (const [name, def] of Object.entries(j.strings ?? {})) {
    if (def.shouldTranslate === false) continue;
    const byLocale = new Map();
    for (const [l, loc] of Object.entries(def.localizations ?? {})) {
      if (loc.stringUnit) byLocale.set(l, { plural: false, text: loc.stringUnit.value });
      else if (loc.variations?.plural) {
        byLocale.set(l, { plural: true, forms: Object.fromEntries(Object.entries(loc.variations.plural).map(([q, v]) => [q, v.stringUnit.value])) });
      }
    }
    out.set(name, byLocale);
  }
  return out;
}

const SPEC = /%%|%(?:(\d+)\$)?([-+ 0#]*\d*(?:\.\d+)?)(l{0,2}[di]|u|@)/g;

export function argCountApple(text) {
  const pos = new Set();
  let seq = 0;
  for (const m of text.matchAll(SPEC)) if (m[0] !== '%%') pos.add(m[1] ? Number(m[1]) : ++seq);
  return pos.size;
}

/** printf-style Apple text to ICU. Returns { icu } or { unsupported }. */
export function toIcuApple(text, inPlural, argTotal) {
  if (/[{}]/.test(text) || (inPlural && text.includes('#'))) return { unsupported: 'literal braces or "#"' };
  let seq = 0;
  let bad = null;
  const icu = text.replace(SPEC, (m, pos, flags, conv) => {
    if (m === '%%') return '%';
    if (flags) {
      bad = `format ${m}`;
      return m;
    }
    const n = pos ? Number(pos) : ++seq;
    if (conv === '@') return argTotal > 1 ? `{value${n}}` : '{value}';
    return inPlural ? '#' : argTotal > 1 ? `{number${n}}` : '{count}';
  });
  if (/%[^%\s]/.test(icu.replace(/%%/g, ''))) bad ??= 'unrecognised format specifier';
  return bad ? { unsupported: bad } : { icu };
}

/** `adminAuditLog` in module `admin` -> `auditLog` (one camelCase segment; matching against Web/Android keys is by normalised name). */
export function pathFromApple(module, name) {
  if (!name.startsWith(module) || name.length === module.length || !/[A-Z]/.test(name[module.length])) return null;
  const rest = name.slice(module.length);
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

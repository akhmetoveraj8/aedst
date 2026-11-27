// Reads Desktop gettext catalogues (.po, msgid = English source text, no plurals) for import-desktop.mjs. The
// msgctxt line (the module, one per crate catalogue) is skipped: a catalogue holds one module.
import { readFileSync } from 'node:fs';

const unq = (s) => s.replace(/\\(["\\n])/g, (_, c) => (c === 'n' ? '\n' : c));

/** @returns {Map<string, string>} msgid -> msgstr (header entry skipped) */
export function parsePo(file) {
  const out = new Map();
  let id = null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const mid = /^msgid "(.*)"$/.exec(line);
    const mstr = /^msgstr "(.*)"$/.exec(line);
    if (mid) id = unq(mid[1]);
    else if (mstr && id !== null) {
      if (id !== '') out.set(id, unq(mstr[1]));
      id = null;
    } else if (/^(msgid_plural|msgstr\[)/.test(line)) throw new Error(`${file}: unsupported entry (plural): ${line}`);
  }
  return out;
}

const BRACES = /\{\}/g;

/** `Waiting to sync: {}` -> ICU with named arguments (`{value}`, or `{value1}`, `{value2}` for several). */
export function poToIcu(text, total) {
  if (/[{}]/.test(text.replace(BRACES, ''))) return { unsupported: 'literal braces' };
  let n = 0;
  return { icu: text.replace(BRACES, () => (total > 1 ? `{value${++n}}` : '{value}')) };
}

export const braceCount = (text) => (text.match(BRACES) ?? []).length;

/** `Show only the tasks of one owner (id)` -> `showOnlyTheTasksOfOne` (first six words, camelCase). */
export function slug(text) {
  const words = text.toLowerCase().replace(/\{\}/g, ' value ').split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6);
  if (!words.length) return 'text';
  return words.map((w, i) => (i ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join('').replace(/^[0-9]/, 'n$&');
}

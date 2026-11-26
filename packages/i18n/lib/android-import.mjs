// Reads Android strings.xml and converts entries to the shared ICU subset (used by import-android.mjs).
import { readFileSync } from 'node:fs';

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// Android string escapes: \' \" \n \\ \@ \?
const unescape = (s) => unxml(s).replace(/\\(['"@?\\])/g, '$1').replace(/\\n/g, '\n');

/** @returns {Map<string, {plural: boolean, text?: string, forms?: Record<string,string>}>} translatable entries only */
export function parseAndroid(file) {
  const xml = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const out = new Map();
  for (const s of xml.matchAll(/<string\s+([^>]*?)>([\s\S]*?)<\/string>/g)) {
    if (/translatable\s*=\s*"false"/.test(s[1])) continue;
    out.set(/name\s*=\s*"([^"]+)"/.exec(s[1])[1], { plural: false, text: unescape(s[2]) });
  }
  for (const s of xml.matchAll(/<plurals\s+([^>]*?)>([\s\S]*?)<\/plurals>/g)) {
    const forms = {};
    for (const i of s[2].matchAll(/<item\s+quantity="(\w+)"[^>]*>([\s\S]*?)<\/item>/g)) forms[i[1]] = unescape(i[2]);
    out.set(/name\s*=\s*"([^"]+)"/.exec(s[1])[1], { plural: true, forms });
  }
  return out;
}

const PRINTF = /%%|%(?:(\d+)\$)?([-+ 0#]*\d*(?:\.\d+)?)([a-zA-Z])/g;

/** Convert printf text to ICU. `inPlural`: `%d` becomes `#`. Returns { icu } or { unsupported }. */
export function toIcu(text, inPlural, argTotal) {
  if (/[{}]/.test(text) || (inPlural && text.includes('#'))) return { unsupported: 'literal braces or "#"' };
  let seq = 0;
  let bad = null;
  const icu = text.replace(PRINTF, (m, pos, flags, conv) => {
    if (m === '%%') return '%';
    if (flags || !['s', 'd'].includes(conv)) {
      bad = `format ${m}`;
      return m;
    }
    const n = pos ? Number(pos) : ++seq;
    if (conv === 'd') return inPlural ? '#' : argTotal > 1 ? `{number${n}}` : '{count}';
    return argTotal > 1 ? `{value${n}}` : '{value}';
  });
  return bad ? { unsupported: bad } : { icu };
}

/** Number of printf arguments in a text (distinct positions). */
export function argCount(text) {
  const pos = new Set();
  let seq = 0;
  for (const m of text.matchAll(PRINTF)) {
    if (m[0] === '%%') continue;
    pos.add(m[1] ? Number(m[1]) : ++seq);
  }
  return pos.size;
}

/** Raw `<string>` lines (as written in the file) for the given names; non-translatable ones when `names` is null. */
export function rawStrings(file, names) {
  const xml = readFileSync(file, 'utf8');
  const out = [];
  for (const m of xml.matchAll(/^[ 	]*<string\s+([^>]*?)>[\s\S]*?<\/string>[ 	]*$/gm)) {
    const name = /name\s*=\s*"([^"]+)"/.exec(m[1])[1];
    if (names ? names.includes(name) : /translatable\s*=\s*"false"/.test(m[1])) out.push(m[0]);
  }
  return out;
}

/** `login_not_configured` -> `login.notConfigured`; a single word stays one segment. */
export function pathFromAndroid(prefix, name) {
  if (prefix && !name.startsWith(`${prefix}_`)) return null;
  const parts = (prefix ? name.slice(prefix.length + 1) : name).split('_').filter(Boolean);
  if (!parts.length) return null;
  const camel = (xs) => xs.map((p, i) => (i ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join('');
  return parts.length === 1 ? parts[0] : `${parts[0]}.${camel(parts.slice(1))}`;
}

export const normKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Text signature that ignores placeholder syntax, for comparing copy across platforms. */
export const signature = (s) => s.replace(PRINTF, '§').replace(/\{[^}]*\}/g, '§').replace(/#/g, '§').replace(/\s+/g, ' ').trim();

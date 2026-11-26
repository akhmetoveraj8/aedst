// Emitters: shared messages -> Android strings.xml, Apple .xcstrings, Desktop gettext .po.
import { argNames, flatten, pluralOf } from './icu.mjs';
import { androidPrefix, applePrefix } from './targets.mjs';

export const LOCALES = ['en', 'ru', 'tg', 'uz', 'ar'];
const ANDROID_DIR = { en: 'values', ru: 'values-ru', tg: 'values-tg', uz: 'values-uz', ar: 'values-ar' };
// gettext plural forms: index -> CLDR category (the last one also covers `other`)
const PO_FORMS = {
  en: { header: 'nplurals=2; plural=(n != 1);', cats: ['one', 'other'] },
  uz: { header: 'nplurals=2; plural=(n != 1);', cats: ['one', 'other'] },
  tg: { header: 'nplurals=2; plural=(n != 1);', cats: ['one', 'other'] },
  ru: {
    header: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
    cats: ['one', 'few', 'many'],
  },
  ar: {
    header: 'nplurals=6; plural=(n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 ? 4 : 5);',
    cats: ['zero', 'one', 'two', 'few', 'many', 'other'],
  },
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
/** `login.errors.opaque_token` in module `auth` -> `auth_login_errors_opaque_token` */
export const androidKey = (prefix, key) => snake([prefix, ...key.split('.')].filter(Boolean).join('_')).replace(/-/g, '_');
/** -> `authLoginErrorsOpaqueToken` */
export const appleKey = (prefix, key) =>
  [prefix, ...key.split('.')]
    .filter(Boolean)
    .join('_')
    .split(/[_-]/)
    .map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : cap(p)))
    .join('');

/** Render a flat segment list. `fmt(name, index1, isCount)` yields the platform placeholder. */
function render(segs, order, esc, fmt, countName) {
  return segs
    .map((s) => (s.t === 'text' ? esc(s.v) : s.t === 'arg' ? fmt(s.name, order.indexOf(s.name) + 1, s.name === countName) : ''))
    .join('');
}

const xml = (s) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/%/g, '%%')
    .replace(/^([@?])/, '\\$1')
    .replace(/\n/g, '\\n');
const pct = (s) => s.replace(/%/g, '%%');
const po = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/** @param {Record<string, any[]>} parsed key -> segs (en order defines argument order) */
export function androidFile(mod, parsedByKey, enOrder) {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<!-- GENERATED from packages/i18n; do not edit -->', '<resources>'];
  for (const [key, segs] of Object.entries(parsedByKey)) {
    const name = androidKey(androidPrefix(mod), key);
    const fmt = (n, i, count) => `%${i}$${count ? 'd' : 's'}`;
    const p = pluralOf(segs);
    if (!p) {
      lines.push(`    <string name="${name}">${render(segs, enOrder[key], xml, fmt)}</string>`);
      continue;
    }
    lines.push(`    <plurals name="${name}">`);
    for (const cat of Object.keys(p.forms)) {
      lines.push(`        <item quantity="${cat}">${render(flatten(segs, cat), enOrder[key], xml, fmt, p.name)}</item>`);
    }
    lines.push('    </plurals>');
  }
  lines.push('</resources>', '');
  return lines.join('\n');
}

export const androidPath = (mod, locale) => `android/${mod}/${ANDROID_DIR[locale]}/strings.xml`;

/** @param {Record<string, Record<string, any[]>>} byLocale locale -> key -> segs */
/** JSON in Xcode's own layout (`"key" : value`, two-space indent) so regenerating does not rewrite whole files. */
function xcodeJson(v, pad = '') {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const inner = `${pad}  `;
  const entries = Object.entries(v);
  if (!entries.length) return Array.isArray(v) ? '[]' : `{\n${pad}}`;
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + xcodeJson(x, inner)).join(',\n')}\n${pad}]`;
  return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)} : ${xcodeJson(x, inner)}`).join(',\n')}\n${pad}}`;
}

/** `local`: raw String Catalog entries kept hand-written (what the shared format cannot express), merged verbatim. */
export function appleFile(mod, byLocale, enOrder, local = {}) {
  const strings = {};
  for (const [key, enSegs] of Object.entries(byLocale.en)) {
    const localizations = {};
    for (const loc of LOCALES) {
      const segs = byLocale[loc][key];
      const fmt = (n, i, count) => `%${i}$${count ? 'lld' : '@'}`;
      const p = pluralOf(segs);
      const unit = (v) => ({ stringUnit: { state: 'translated', value: v } });
      if (!p) {
        localizations[loc] = unit(render(segs, enOrder[key], pct, fmt));
        continue;
      }
      const plural = {};
      for (const cat of Object.keys(p.forms)) plural[cat] = unit(render(flatten(segs, cat), enOrder[key], pct, fmt, p.name));
      localizations[loc] = { variations: { plural } };
    }
    strings[appleKey(applePrefix(mod), key)] = { extractionState: 'manual', localizations };
    void enSegs;
  }
  Object.assign(strings, local);
  for (const def of Object.values(strings)) def.localizations = Object.fromEntries(Object.entries(def.localizations ?? {}).sort(([x], [y]) => x.localeCompare(y)));
  const sorted = Object.fromEntries(Object.entries(strings).sort(([x], [y]) => x.localeCompare(y)));
  return `${xcodeJson({ sourceLanguage: 'en', strings: sorted, version: '1.1' })}\n`;
}

export const applePath = (mod) => `apple/${mod}/Localizable.xcstrings`;

/** Gettext catalogue for one locale. The English text is the msgid (Slint `@tr`); there is no msgctxt. `local`: hand-written entries kept verbatim. */
export function poFile(mod, locale, byLocale, enOrder, local = {}) {
  const forms = PO_FORMS[locale];
  const fmt = () => '{}';
  const out = [
    '# GENERATED from packages/i18n; do not edit',
    'msgid ""',
    'msgstr ""',
    `"Project-Id-Version: ${mod}\\n"`,
    `"Language: ${locale}\\n"`,
    '"MIME-Version: 1.0\\n"',
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '"Content-Transfer-Encoding: 8bit\\n"',
    `"Plural-Forms: ${forms.header}\\n"`,
    '',
  ];
  const seen = new Set();
  for (const [key, enSegs] of Object.entries(byLocale.en)) {
    const segs = byLocale[locale][key];
    const p = pluralOf(segs);
    const ep = pluralOf(enSegs);
    // Slint looks entries up by `@tr("" => "English")`: the msgid is the English text and there is no msgctxt.
    const id = render(enSegs, enOrder[key], (t) => t, fmt);
    if (seen.has(id)) throw new Error(`${mod}: two keys have the same English text "${id}" on Desktop (key ${key})`);
    seen.add(id);
    if (!p) {
      out.push(`msgid "${po(render(enSegs, enOrder[key], (s) => s, fmt))}"`, `msgstr "${po(render(segs, enOrder[key], (s) => s, fmt))}"`);
    } else {
      out.push(
        `msgid "${po(render(flatten(enSegs, 'one'), enOrder[key], (s) => s, fmt, ep.name))}"`,
        `msgid_plural "${po(render(flatten(enSegs, 'other'), enOrder[key], (s) => s, fmt, ep.name))}"`,
      );
      forms.cats.forEach((cat, i) =>
        out.push(`msgstr[${i}] "${po(render(flatten(segs, cat), enOrder[key], (s) => s, fmt, p.name))}"`),
      );
    }
    out.push('');
  }
  return out.join('\n');
}

/** Web: a verbatim, normalised copy of the shared file (Web resolves `tj` to `tg.json` itself). */
export const webPath = (mod, locale) => `../../apps/web/shared/i18n/catalogs/${mod}/${locale}.json`;

export const poPath = (mod, locale) => `desktop/${mod}/${locale}/LC_MESSAGES/${mod}.po`;
export { argNames };

#!/usr/bin/env node
// i18n parity check across Web (JSON), Android (strings.xml), Apple (.xcstrings) and
// Desktop (gettext .po in apps/desktop). Locales: en, ru, tg (Web calls Tajik `tj`; canonical here is `tg`, ISO 639-1),
// uz, ar. Documented in docs/content/i18n.md ("Parity check").
//
// Within one platform, every bundle (a Web `i18n/` dir, an Android module `res/`, an Apple
// `.xcstrings` file, a Desktop crate's `.po` family) must define the same keys in all locales, with the
// same placeholders. Optionally (`--cross`) the logical key sets of Web / Android / Apple are
// compared with each other using the key-mapping convention below.
//
// Key-mapping convention (cross-platform comparison only):
//   Web      <module>.<section>.<key>   (the module/bundle name is the first segment; the shared
//                                        bundle `app/config/i18n/common` is module `common`)
//   Android  <module>_<section>_<key>   (snake_case, already module-prefixed)
//   Apple    <module><Section><Key>     (lowerCamelCase, module-prefixed)
//   Desktop  English source text (gettext msgid); not comparable by name, so per-platform only.
// All of them normalise to lowercase [a-z0-9] only, so `auth.login.title`, `auth_login_title`
// and `authLoginTitle` are the same logical key.
//
// Usage: node scripts/check-i18n-parity.mjs [--cross] [--strict-cross] [--json] [--platform web|android|apple|desktop]
// Exit 1 on any per-platform issue not covered by scripts/i18n-parity.allowlist
// (and on cross-platform gaps only with --strict-cross).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The Apple helpers live inside apps/apple, which `template-new` removes in the core and mobile-less profiles.
const appleChecksFile = path.join(root, 'apps/apple/scripts/i18n-apple-checks.mjs');
const { applePluralIssues, appleFormatBanIssues } = existsSync(appleChecksFile)
  ? await import(pathToFileURL(appleChecksFile).href)
  : { applePluralIssues: () => [], appleFormatBanIssues: () => [] };
const LOCALES = ['en', 'ru', 'tg', 'uz', 'ar'];
const REFERENCE = 'en';
const args = new Set(process.argv.slice(2));
const onlyPlatform = process.argv.includes('--platform') ? process.argv[process.argv.indexOf('--platform') + 1] : null;
const strictCross = args.has('--strict-cross');
const cross = args.has('--cross') || strictCross;

const canon = (l) => (l === 'tj' ? 'tg' : l);
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
  .split('\n')
  .filter(Boolean)
  .filter((f) => existsSync(path.join(root, f)));

// ------------------------------------------------------------- placeholders
const unique = (a) => [...new Set(a)].sort();
// ICU plural/select option bodies (`one {Sent to # user}`) are text, not arguments: drop the selector's brace.
const icuSel = (s) => s.replace(/(?:zero|one|two|few|many|other|=\d+)\s*\{/g, ' ');
const phWeb = (s) => unique([...icuSel(s).matchAll(/\{\s*([A-Za-z_]\w*)/g)].map((m) => m[1]));
const phPrintf = (s) =>
  unique([...s.matchAll(/%(?:(\d+)\$)?[-+ 0#]*\d*(?:\.\d+)?(?:l{0,2}|h{0,2})([@dsfiuxXcCeEgG])/g)].map((m) => m[1] ?? m[2]));
// Rust gettext/format strings use positional `{}`; the count must match, so no unique().
const phBraces = (s) => [...s.matchAll(/\{\}/g)].map(() => '{}');

// ---------------------------------------------------------------- loaders
/** Each loader returns bundles: { id, entries: Map<locale, Map<key, string>> } */
function loadWeb() {
  const dirs = new Map();
  for (const f of files) {
    // A bundle is `i18n/<locale>.json` or a named catalogue below it, `i18n/<name>/<locale>.json` (the shell's `common`).
    const m = /^apps\/web\/((?:app|admin|landing)\/src|shared)\/(.*\/)?i18n\/(?:([a-z][a-z0-9-]*)\/)?([a-z]{2})\.json$/.exec(f);
    if (!m) continue;
    const id = `apps/web/${m[1]}/${m[2] ?? ''}i18n${m[3] ? `/${m[3]}` : ''}`;
    if (!dirs.has(id)) dirs.set(id, new Map());
    const flat = new Map();
    const walk = (o, p) => {
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object') walk(v, `${p}${k}.`);
        else flat.set(`${p}${k}`, String(v));
      }
    };
    walk(JSON.parse(read(f)), '');
    dirs.get(id).set(canon(m[4]), flat);
  }
  return [...dirs].map(([id, entries]) => ({ id, entries, ph: phWeb, module: webModule(id) }));
}
const webModule = (id) => (/modules\/([^/]+)\/i18n$/.exec(id)?.[1] ?? (id.endsWith('/common') ? 'common' : id.split('/').slice(-2)[0]));

const unxml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function loadAndroid() {
  const dirs = new Map();
  for (const f of files) {
    const m = /^(apps\/android\/.*\/src\/main\/res)\/values(?:-([a-z]{2}))?\/strings\.xml$/.exec(f);
    if (!m) continue;
    // `values/` (no qualifier) is the default locale of the project = English (see docs/content/android/i18n.md);
    // Russian is `values-ru/`, like every other locale.
    const locale = canon(m[2] ?? 'en');
    const flat = new Map();
    const xml = read(f).replace(/<!--[\s\S]*?-->/g, '');
    for (const s of xml.matchAll(/<string\s+([^>]*?)>([\s\S]*?)<\/string>/g)) {
      if (/translatable\s*=\s*"false"/.test(s[1])) continue;
      flat.set(/name\s*=\s*"([^"]+)"/.exec(s[1])[1], unxml(s[2]));
    }
    for (const s of xml.matchAll(/<(plurals|string-array)\s+([^>]*?)>([\s\S]*?)<\/\1>/g)) {
      if (/translatable\s*=\s*"false"/.test(s[2])) continue;
      const items = [...s[3].matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)].map((i) => unxml(i[1]));
      flat.set(/name\s*=\s*"([^"]+)"/.exec(s[2])[1], items.join('\u0000'));
    }
    if (!dirs.has(m[1])) dirs.set(m[1], new Map());
    dirs.get(m[1]).set(locale, flat);
  }
  return [...dirs].map(([id, entries]) => ({ id, entries, ph: phPrintf, module: null }));
}

function loadApple() {
  const out = [];
  for (const f of files.filter((x) => /^apps\/apple\/.*\.xcstrings$/.test(x))) {
    const j = JSON.parse(read(f));
    const entries = new Map(LOCALES.map((l) => [l, new Map()]));
    for (const [key, def] of Object.entries(j.strings ?? {})) {
      if (def.shouldTranslate === false) continue;
      for (const l of LOCALES) {
        const loc = def.localizations?.[l];
        if (!loc) continue;
        const units = [];
        const collect = (o) => {
          if (!o || typeof o !== 'object') return;
          if (o.stringUnit?.value !== undefined && o.stringUnit.state !== 'new') units.push(o.stringUnit.value);
          for (const v of Object.values(o)) collect(v);
        };
        collect(loc);
        if (units.length) entries.get(l).set(key, units.join('\u0000'));
      }
    }
    out.push({ id: f, entries, ph: phPrintf, module: null, appleExtra: applePluralIssues(j) });
  }
  return out;
}

function poStrings(src) {
  // Minimal gettext .po reader: msgid / msgid_plural / msgstr / msgstr[n], with continuation lines.
  const UNESC = { n: '\n', t: '\t' };
  const unq = (s) => s.replace(/\\(["\\nt])/g, (_, c) => UNESC[c] ?? c);
  const out = new Map();
  let cur = null;
  let field = null;
  const flush = () => {
    if (cur && cur.msgid !== undefined && cur.msgid !== '' && !cur.fuzzy) out.set((cur.msgctxt ? `${cur.msgctxt}::` : '') + cur.msgid, cur.msgstr ?? '');
    cur = null;
  };
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') { flush(); continue; }
    if (line.startsWith('#,') && /fuzzy/.test(line)) { cur ??= {}; cur.fuzzy = true; continue; }
    if (line.startsWith('#')) continue;
    const m = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+"(.*)"$/.exec(line);
    if (m) {
      cur ??= {};
      field = m[1].startsWith('msgstr') ? 'msgstr' : m[1] === 'msgid_plural' ? 'plural' : m[1];
      if (field === 'msgstr' && cur.msgstr !== undefined) cur.msgstr += '\u0000' + unq(m[2]);
      else cur[field] = unq(m[2]);
      continue;
    }
    const c = /^"(.*)"$/.exec(line);
    if (c && cur && field) cur[field] = (cur[field] ?? '') + unq(c[1]);
  }
  flush();
  return out;
}

// Desktop (apps/desktop): one gettext bundle per crate, <crate>/i18n/<locale>/LC_MESSAGES/<name>.po.
function loadDesktop() {
  const fam = new Map();
  for (const f of files) {
    const m = /^(apps\/desktop\/.*\/i18n)\/([a-z]{2})\/LC_MESSAGES\/[^/]+\.po$/.exec(f);
    if (!m) continue;
    const entries = fam.get(m[1]) ?? new Map();
    const flat = new Map();
    for (const [k, v] of poStrings(read(f))) {
      // An empty msgstr is untranslated, i.e. missing; `en` is the source language.
      if (m[2] !== REFERENCE && v === '') continue;
      flat.set(k, m[2] === REFERENCE && v === '' ? k : v);
    }
    entries.set(canon(m[2]), flat);
    fam.set(m[1], entries);
  }
  return [...fam].map(([id, entries]) => ({ id, entries, ph: phBraces, module: null }));
}

const platforms = { web: loadWeb(), android: loadAndroid(), apple: loadApple(), desktop: loadDesktop() };

// Apple only: ban String(format: String(localized:)) in Swift sources (scripts live in apps/apple/scripts).
const appleFormatBan = files
  .filter((f) => /^apps\/apple\/.*\.swift$/.test(f) && !/\/(Generated|\.build)\//.test(f))
  .flatMap((f) => appleFormatBanIssues(read(f)).map((h) => ({ file: f, ...h })));

// -------------------------------------------------------------- allowlist
// Line: `<platform> <bundle-glob> <key-glob>   # reason`; `*` matches any run of characters.
const allowFile = 'scripts/i18n-parity.allowlist';
const re = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
const allow = existsSync(path.join(root, allowFile))
  ? read(allowFile)
      .split('\n')
      .map((l) => l.replace(/#.*/, '').trim())
      .filter(Boolean)
      .map((l) => {
        const [p, b, k] = l.split(/\s+/);
        return { p, b: re(b ?? '*'), k: re(k ?? '*') };
      })
  : [];
const allowed = (p, bundle, key) => allow.some((a) => (a.p === p || a.p === '*') && a.b.test(bundle) && a.k.test(key));

// ----------------------------------------------------------------- checks
const issues = [];
const summary = {};
for (const [platform, bundles] of Object.entries(platforms)) {
  if (onlyPlatform && onlyPlatform !== platform) continue;
  summary[platform] = { bundles: bundles.length, missing: 0, extra: 0, placeholder: 0, absentLocale: 0, plural: 0, formatBan: 0 };
  for (const b of bundles) {
    for (const x of b.appleExtra ?? []) {
      if (allowed(platform, b.id, x.key)) continue;
      issues.push({ platform, bundle: b.id, kind: 'plural', locale: x.locale, key: x.key, detail: x.detail });
      summary[platform].plural++;
    }
    const ref = b.entries.get(REFERENCE);
    if (!ref) {
      if (allowed(platform, b.id, "*")) continue;
      issues.push({ platform, bundle: b.id, kind: 'absentLocale', locale: REFERENCE, key: '*' });
      summary[platform].absentLocale++;
      continue;
    }
    for (const l of LOCALES) {
      if (l === REFERENCE) continue;
      const cur = b.entries.get(l);
      if (!cur) {
        if (allowed(platform, b.id, "*")) continue;
        issues.push({ platform, bundle: b.id, kind: 'absentLocale', locale: l, key: '*' });
        summary[platform].absentLocale++;
        continue;
      }
      for (const [k, v] of ref) {
        if (allowed(platform, b.id, k)) continue;
        if (!cur.has(k)) {
          issues.push({ platform, bundle: b.id, kind: 'missing', locale: l, key: k });
          summary[platform].missing++;
        } else if (JSON.stringify(b.ph(v)) !== JSON.stringify(b.ph(cur.get(k)))) {
          issues.push({ platform, bundle: b.id, kind: 'placeholder', locale: l, key: k, detail: `${b.ph(v)} vs ${b.ph(cur.get(k))}` });
          summary[platform].placeholder++;
        }
      }
      for (const k of cur.keys()) {
        if (!ref.has(k) && !allowed(platform, b.id, k)) {
          issues.push({ platform, bundle: b.id, kind: 'extra', locale: l, key: k });
          summary[platform].extra++;
        }
      }
    }
  }
}

// Apple: String(format: String(localized:)) ban (see apps/apple/scripts/i18n-apple-checks.mjs).
for (const h of appleFormatBan) {
  if (allowed('apple', h.file, '*')) continue;
  issues.push({ platform: 'apple', bundle: h.file, kind: 'formatBan', locale: '-', key: 'line ' + h.line, detail: h.text });
  if (summary.apple) summary.apple.formatBan++;
}

// ------------------------------------------------------- cross-platform
const crossIssues = [];
if (cross) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const pool = (platform) => {
    const m = new Map(); // normalised -> original
    for (const b of platforms[platform]) {
      const ref = b.entries.get(REFERENCE);
      if (!ref) continue;
      for (const k of ref.keys()) {
        if (allowed(`cross-${platform}`, b.id, k)) continue;
        // Web: module name is the first segment; Android/Apple keys are already module-prefixed.
        m.set(norm(platform === 'web' ? `${b.module}${k}` : platform === 'apple' ? k.replace(/\s*%(?:\d+\$)?l{0,2}[@dDiuUsf]/g, '') : k), `${b.id}: ${k}`);
      }
    }
    return m;
  };
  const pools = { web: pool('web'), android: pool('android'), apple: pool('apple') };
  for (const [p, m] of Object.entries(pools)) {
    for (const [nk, orig] of m) {
      const lacking = Object.keys(pools).filter((q) => q !== p && !pools[q].has(nk));
      if (lacking.length) crossIssues.push({ platform: p, key: orig, lacking });
    }
  }
}

// ----------------------------------------------------------------- report
if (args.has('--json')) {
  console.log(JSON.stringify({ summary, issues, crossIssues }, null, 2));
} else {
  const limit = 15;
  for (const [platform, s] of Object.entries(summary)) {
    const list = issues.filter((i) => i.platform === platform);
    console.log(`\n== ${platform}: ${s.bundles} bundle(s); missing ${s.missing}, extra ${s.extra}, placeholder ${s.placeholder}, absent locale files ${s.absentLocale}${platform === 'apple' ? `, plural ${s.plural}, formatBan ${s.formatBan}` : ''}`);
    const byBundle = Map.groupBy(list, (i) => i.bundle);
    for (const [bundle, items] of byBundle) {
      const c = (k) => items.filter((i) => i.kind === k).length;
      console.log(`  ${bundle}: missing ${c('missing')}, extra ${c('extra')}, placeholder ${c('placeholder')}, absent ${c('absentLocale')}, plural ${c('plural')}, formatBan ${c('formatBan')}`);
      for (const i of items.slice(0, limit)) console.log(`    [${i.locale}] ${i.kind} ${i.key}${i.detail ? ` (${i.detail})` : ''}`);
      if (items.length > limit) console.log(`    ... ${items.length - limit} more (use --json for all)`);
    }
  }
  if (cross) {
    console.log(`\n== cross-platform (web/android/apple, reference locale ${REFERENCE}): ${crossIssues.length} logical key(s) not present everywhere (informational unless --strict-cross)`);
    for (const i of crossIssues.slice(0, 25)) console.log(`  ${i.platform} ${i.key} -> missing on ${i.lacking.join(', ')}`);
    if (crossIssues.length > 25) console.log(`  ... ${crossIssues.length - 25} more (use --json for all)`);
  }
}
const failed = issues.length > 0 || (strictCross && crossIssues.length > 0);
if (!args.has('--json')) console.log(failed ? `\nFAIL: ${issues.length} per-platform issue(s)${strictCross ? ` + ${crossIssues.length} cross` : ''}` : '\nOK: i18n parity');
process.exit(failed ? 1 : 0);

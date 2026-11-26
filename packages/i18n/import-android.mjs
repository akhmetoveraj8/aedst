// Merges the hand-written Android catalogs into the shared JSON (migration tool, run once per module).
//   node import-android.mjs            report only
//   node import-android.mjs --apply    write shared JSON + targets.json
// Web text wins when a logical key exists on both platforms; Android-only strings are added with
// targets ["android"]; strings the shared format cannot express are listed and stay hand-written.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { androidKey } from './lib/emit.mjs';
import { argCount, normKey, parseAndroid, pathFromAndroid, rawStrings, signature, toIcu } from './lib/android-import.mjs';
import { ANDROID_HOMES, androidPrefix } from './lib/targets.mjs';
import { LOCALES, flat, listModules, root } from './lib/load.mjs';

const repo = path.resolve(root, '..', '..');
const only = process.argv.includes('--modules') ? process.argv[process.argv.indexOf('--modules') + 1].split(',') : null;
const ANDROID_DIR = { en: 'values', ru: 'values-ru', tg: 'values-tg', uz: 'values-uz', ar: 'values-ar' };
const apply = process.argv.includes('--apply');

function setPath(obj, key, value) {
  const parts = key.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts.at(-1)] = value;
}

const report = { added: 0, matched: 0, conflicts: [], skipped: [] };
for (const [mod, { home }] of Object.entries(ANDROID_HOMES).filter(([m]) => !only || only.includes(m))) {
  const homes = [home];
  const prefix = androidPrefix(mod);
  const skippedNames = [];
  const sharedFile = (l) => path.join(root, mod, `${l}.json`);
  const shared = Object.fromEntries(LOCALES.map((l) => [l, existsSync(sharedFile(l)) ? JSON.parse(readFileSync(sharedFile(l), 'utf8')) : {}]));
  const webKeys = Object.keys(flat(shared.en));
  const webByNorm = new Map(webKeys.map((k) => [normKey(`${prefix}.${k}`), k]));
  const targetsFile = path.join(root, mod, 'targets.json');
  const targets = existsSync(targetsFile) ? JSON.parse(readFileSync(targetsFile, 'utf8')) : {};
  for (const k of webKeys) targets[k] ??= ['web'];

  const android = Object.fromEntries(
    LOCALES.map((l) => [l, new Map(homes.flatMap((h) => [...parseAndroid(path.join(repo, 'apps/android', h, 'src/main/res', ANDROID_DIR[l], 'strings.xml'))]))]),
  );
  for (const [name, en] of android.en) {
    if (prefix && !name.startsWith(`${prefix}_`)) continue;
    const webKey = webByNorm.get(normKey(name));
    const derived = pathFromAndroid(prefix, name);
    let key = webKey ?? derived;
    // A leaf cannot also be a section: when the derived path collides with an existing key, flatten it into one camelCase segment.
    const taken = Object.keys(flat(shared.en));
    const clashes = (k) => taken.some((t) => t === k || t.startsWith(`${k}.`) || k.startsWith(`${t}.`));
    if (!webKey && clashes(key)) {
      key = key.split('.').map((p, i) => (i ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join('');
      if (clashes(key)) {
        report.skipped.push(`${name}: key ${key} collides with an existing section or key`);
        skippedNames.push(name);
        continue;
      }
    }
    const why = [];
    if (androidKey(prefix, key) !== name) why.push(`name would become ${androidKey(prefix, key)}`);
    if (en.plural && Object.keys(en.forms).some((q) => !['zero', 'one', 'two', 'few', 'many', 'other'].includes(q))) why.push('unknown plural category');
    if (webKey) {
      const webText = flat(shared.en)[webKey];
      const enText = en.plural ? en.forms.other : en.text;
      if (!en.plural && !webText.includes('plural,') && signature(webText) !== signature(enText)) {
        report.conflicts.push(`${mod}.${webKey}: web "${webText}" vs android "${enText}"`);
      }
      if (why.length) {
        report.skipped.push(`${name}: ${why.join('; ')}`);
        skippedNames.push(name);
      } else {
        report.matched++;
        targets[webKey] = [...new Set([...(targets[webKey] ?? ['web']), 'android'])];
      }
      continue;
    }
    const total = argCount(en.plural ? en.forms.other : en.text);
    const texts = {};
    for (const l of LOCALES) {
      const e = android[l].get(name);
      if (!e || e.plural !== en.plural) {
        why.push(`${l} missing or different kind`);
        break;
      }
      if (e.plural) {
        const forms = Object.entries(e.forms).map(([q, t]) => [q, toIcu(t, true, total)]);
        const bad = forms.find(([, r]) => r.unsupported);
        if (bad) why.push(`${l}: ${bad[1].unsupported}`);
        else texts[l] = `{count, plural, ${forms.map(([q, r]) => `${q} {${r.icu}}`).join(' ')}}`;
      } else {
        const r = toIcu(e.text, false, total);
        if (r.unsupported) why.push(`${l}: ${r.unsupported}`);
        else texts[l] = r.icu;
      }
    }
    if (why.length) {
      report.skipped.push(`${name}: ${why.join('; ')}`);
      skippedNames.push(name);
      continue;
    }
    for (const l of LOCALES) setPath(shared[l], key, texts[l]);
    targets[key] = ['android'];
    report.added++;
  }
  if (apply) {
    mkdirSync(path.join(root, mod), { recursive: true });
    // Hand-written leftovers (non-translatable ids and what the shared format cannot express) move to strings_local.xml.
    for (const l of LOCALES) {
      const dir = path.join(repo, 'apps/android', home, 'src/main/res', ANDROID_DIR[l]);
      const file = path.join(dir, 'strings.xml');
      const lines = [...rawStrings(file, null), ...rawStrings(file, skippedNames)];
      if (lines.length) {
        const head = '<?xml version="1.0" encoding="utf-8"?>\n<!-- Hand-written: strings the shared JSON cannot express yet (non-translatable ids, unsupported formats, name clashes). Everything else is generated into strings.xml. -->\n<resources>\n';
        writeFileSync(path.join(dir, 'strings_local.xml'), `${head}${lines.join('\n')}\n</resources>\n`);
      }
    }
    for (const l of LOCALES) writeFileSync(sharedFile(l), `${JSON.stringify(shared[l], null, 2)}\n`);
    mkdirSync(path.dirname(targetsFile), { recursive: true });
    writeFileSync(targetsFile, `${JSON.stringify(Object.fromEntries(Object.entries(targets).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
  }
}
if (apply) {
  // Modules Android does not own yet: every existing key is Web-only until another platform adopts it.
  for (const mod of listModules().filter((m) => !(m in ANDROID_HOMES))) {
    const file = path.join(root, mod, 'targets.json');
    if (existsSync(file)) continue;
    const keys = Object.keys(flat(JSON.parse(readFileSync(path.join(root, mod, 'en.json'), 'utf8')))).sort((a, b) => a.localeCompare(b));
    writeFileSync(file, `${JSON.stringify(Object.fromEntries(keys.map((k) => [k, ['web']])), null, 2)}
`);
  }
}
console.log(`android import${apply ? ' (applied)' : ' (report only)'}: matched ${report.matched}, added ${report.added}, conflicts ${report.conflicts.length}, skipped ${report.skipped.length}`);
for (const c of report.conflicts) console.log(`  conflict ${c}`);
for (const s of report.skipped) console.log(`  skipped ${s}`);

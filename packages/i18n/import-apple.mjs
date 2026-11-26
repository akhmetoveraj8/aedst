// Merges the hand-written Apple String Catalogs into the shared JSON (migration tool, like import-android.mjs).
//   node import-apple.mjs            report only
//   node import-apple.mjs --apply    write shared JSON + targets.json
// A string whose logical key already exists (Web or Android) shares it and the existing text wins; Apple-only
// strings are added with targets ["apple"]; anything the shared format cannot express stays hand-written.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { normKey, signature } from './lib/android-import.mjs';
import { argCountApple, parseXcstrings, pathFromApple, toIcuApple } from './lib/apple-import.mjs';
import { appleKey } from './lib/emit.mjs';
import { LOCALES, flat, root } from './lib/load.mjs';
import { APPLE_HOMES, applePrefix } from './lib/targets.mjs';

const repo = path.resolve(root, '..', '..');
const apply = process.argv.includes('--apply');
const only = process.argv.includes('--modules') ? process.argv[process.argv.indexOf('--modules') + 1].split(',') : null;
const CATS = ['zero', 'one', 'two', 'few', 'many', 'other'];

function setPath(obj, key, value) {
  const parts = key.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts.at(-1)] = value;
}

const report = { added: 0, matched: 0, conflicts: [], skipped: [] };
const rawDefs = (home) => JSON.parse(readFileSync(path.join(repo, 'apps/apple', home), 'utf8')).strings;
for (const [mod, { file: home }] of Object.entries(APPLE_HOMES).filter(([m]) => !only || only.includes(m))) {
  const prefix = applePrefix(mod);
  const sharedFile = (l) => path.join(root, mod, `${l}.json`);
  const shared = Object.fromEntries(LOCALES.map((l) => [l, existsSync(sharedFile(l)) ? JSON.parse(readFileSync(sharedFile(l), 'utf8')) : {}]));
  const targetsFile = path.join(root, mod, 'targets.json');
  const targets = existsSync(targetsFile) ? JSON.parse(readFileSync(targetsFile, 'utf8')) : {};
  const apple = parseXcstrings(path.join(repo, 'apps/apple', home));
  const local = {};
  const skip = (name, reason) => {
    report.skipped.push(`${name}: ${reason}`);
    local[name] = rawDefs(home)[name];
  };

  for (const [name, byLocale] of apple) {
    const en = byLocale.get('en');
    const webByNorm = new Map(Object.keys(flat(shared.en)).map((k) => [normKey(`${prefix}.${k}`), k]));
    const existing = webByNorm.get(normKey(name));
    const derived = pathFromApple(prefix, name);
    const why = [];
    if (!en) why.push('no en text');
    if (!existing && !derived) why.push('name is not module-prefixed camelCase');
    const key = existing ?? derived;
    if (key && !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)) why.push('interpolated key (spaces or format specifiers)');
    if (key && appleKey(prefix, key) !== name) why.push(`name would become ${appleKey(prefix, key)}`);
    if (why.length) {
      skip(name, why.join('; '));
      continue;
    }
    if (existing) {
      const sharedText = flat(shared.en)[existing];
      const enText = en.plural ? en.forms.other : en.text;
      if (!en.plural && !sharedText.includes('plural,') && signature(sharedText) !== signature(enText)) {
        report.conflicts.push(`${mod}.${existing}: shared "${sharedText}" vs apple "${enText}"`);
      }
      report.matched++;
      targets[existing] = [...new Set([...(targets[existing] ?? ['web']), 'apple'])];
      continue;
    }
    const taken = Object.keys(flat(shared.en));
    if (taken.some((t) => t === key || t.startsWith(`${key}.`) || key.startsWith(`${t}.`))) {
      skip(name, `key ${key} collides with an existing section or key`);
      continue;
    }
    const total = argCountApple(en.plural ? en.forms.other : en.text);
    const texts = {};
    for (const l of LOCALES) {
      const e = byLocale.get(l);
      if (!e || e.plural !== en.plural) {
        why.push(`${l} missing or different kind`);
        break;
      }
      if (e.plural) {
        const forms = Object.entries(e.forms).map(([q, t]) => [q, toIcuApple(t, true, total)]);
        const bad = forms.find(([q, r]) => r.unsupported || !CATS.includes(q));
        if (bad) why.push(`${l}: ${bad[1].unsupported ?? 'unknown plural category'}`);
        else texts[l] = `{count, plural, ${forms.map(([q, r]) => `${q} {${r.icu}}`).join(' ')}}`;
      } else {
        const r = toIcuApple(e.text, false, total);
        if (r.unsupported) why.push(`${l}: ${r.unsupported}`);
        else texts[l] = r.icu;
      }
    }
    if (why.length) {
      skip(name, why.join('; '));
      continue;
    }
    for (const l of LOCALES) setPath(shared[l], key, texts[l]);
    targets[key] = ['apple'];
    report.added++;
  }
  if (apply) {
    mkdirSync(path.join(root, mod), { recursive: true });
    writeFileSync(path.join(root, mod, 'apple-local.json'), `${JSON.stringify(local, null, 2)}
`);
    for (const l of LOCALES) writeFileSync(sharedFile(l), `${JSON.stringify(shared[l], null, 2)}\n`);
    writeFileSync(targetsFile, `${JSON.stringify(Object.fromEntries(Object.entries(targets).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
  }
}
console.log(`apple import${apply ? ' (applied)' : ' (report only)'}: matched ${report.matched}, added ${report.added}, conflicts ${report.conflicts.length}, skipped ${report.skipped.length}`);
for (const c of report.conflicts) console.log(`  conflict ${c}`);
for (const s of report.skipped) console.log(`  skipped ${s}`);

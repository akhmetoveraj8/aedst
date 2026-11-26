// Merges the hand-written Desktop gettext catalogues into the shared JSON (migration tool, like import-android.mjs).
//   node import-desktop.mjs            report only
//   node import-desktop.mjs --apply    write shared JSON, targets.json and <module>/desktop-local.json
// Desktop has no key names: its msgid is the English text that `@tr("" => "...")` in the Slint sources must keep
// matching. A string is shared when a key with the SAME English text already exists in the module (existing
// translations win); otherwise it becomes a Desktop-only key named after its first words. Entries that cannot be
// expressed (a locale missing, braces, mismatching `{}` count) stay hand-written in desktop-local.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { signature } from './lib/android-import.mjs';
import { LOCALES, flat, root } from './lib/load.mjs';
import { braceCount, parsePo, poToIcu, slug } from './lib/po-import.mjs';
import { DESKTOP_HOMES } from './lib/targets.mjs';

const repo = path.resolve(root, '..', '..');
const apply = process.argv.includes('--apply');
const poFile = (crate, l) => path.join(repo, 'apps/desktop/crates', crate, 'i18n', l, 'LC_MESSAGES', `${crate}.po`);

const report = { matched: 0, added: 0, textDiffs: [], skipped: [] };
for (const [crate, mod] of Object.entries(DESKTOP_HOMES)) {
  const sharedFile = (l) => path.join(root, mod, `${l}.json`);
  const sharedExists = existsSync(sharedFile('en'));
  const shared = Object.fromEntries(LOCALES.map((l) => [l, sharedExists ? JSON.parse(readFileSync(sharedFile(l), 'utf8')) : {}]));
  const targetsFile = path.join(root, mod, 'targets.json');
  const targets = existsSync(targetsFile) ? JSON.parse(readFileSync(targetsFile, 'utf8')) : {};
  const po = Object.fromEntries(LOCALES.map((l) => [l, parsePo(poFile(crate, l))]));
  const local = {};

  for (const msgid of po.en.keys()) {
    const sharedEn = flat(shared.en);
    const why = [];
    const total = braceCount(msgid);
    for (const l of LOCALES) {
      const t = po[l].get(msgid);
      if (!t) why.push(`${l} untranslated`);
      else if (braceCount(t) !== total) why.push(`${l} has a different number of {}`);
    }
    const icuEn = poToIcu(msgid, total);
    if (icuEn.unsupported) why.push(icuEn.unsupported);
    if (why.length) {
      local[msgid] = Object.fromEntries(LOCALES.map((l) => [l, po[l].get(msgid) ?? '']));
      report.skipped.push(`${crate}: "${msgid}": ${why.join('; ')}`);
      continue;
    }
    const sameText = Object.entries(sharedEn).find(([, v]) => !v.includes('plural,') && signature(v) === signature(msgid) && v.replace(/\{[^}]*\}/g, '{}') === msgid);
    if (sameText) {
      const key = sameText[0];
      for (const l of LOCALES.filter((x) => x !== 'en')) {
        const have = flat(shared[l])[key];
        if (have !== undefined && signature(have) !== signature(po[l].get(msgid))) report.textDiffs.push(`${mod}.${key} [${l}]: shared "${have}" vs desktop "${po[l].get(msgid)}"`);
      }
      targets[key] = [...new Set([...(targets[key] ?? ['web']), 'desktop'])];
      report.matched++;
      continue;
    }
    let key = slug(msgid);
    const taken = new Set(Object.keys(sharedEn));
    for (let i = 2; [...taken].some((t) => t === key || t.startsWith(`${key}.`)) && i < 99; i++) key = `${slug(msgid)}${i}`;
    for (const l of LOCALES) shared[l][key] = poToIcu(po[l].get(msgid), total).icu;
    targets[key] = ['desktop'];
    report.added++;
  }
  if (apply) {
    mkdirSync(path.join(root, mod), { recursive: true });
    for (const l of LOCALES) writeFileSync(sharedFile(l), `${JSON.stringify(shared[l], null, 2)}\n`);
    writeFileSync(targetsFile, `${JSON.stringify(Object.fromEntries(Object.entries(targets).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
    writeFileSync(path.join(root, mod, 'desktop-local.json'), `${JSON.stringify(local, null, 2)}\n`);
  }
}
console.log(`desktop import${apply ? ' (applied)' : ' (report only)'}: matched ${report.matched}, added ${report.added}, text differences ${report.textDiffs.length}, skipped ${report.skipped.length}`);
for (const d of report.textDiffs) console.log(`  differs ${d}`);
for (const s of report.skipped) console.log(`  skipped ${s}`);

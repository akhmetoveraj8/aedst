#!/usr/bin/env node
// Verifies features.yaml (feature x platform x status, behaviour x platform x status) against the tree, and the shape of
// every feature on every platform (scripts/features/shape.mjs).
// Usage: node scripts/check-features.mjs [--require-complete] [--json]
//   default            fail on drift: undeclared/missing feature dirs, missing evidence, status above the
//                      platform's verification level, `missing` without `tracking`, `na` without `reason`.
//   --require-complete also fail while any behaviour is `missing` (release gate).
// Docs: docs/content/parity.md
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { checkShape } from './features/shape.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parse } = createRequire(import.meta.url)('yaml');
const args = new Set(process.argv.slice(2));
const doc = parse(readFileSync(path.join(root, 'features.yaml'), 'utf8'));

const errors = [];
const gaps = [];
const fail = (m) => errors.push(m);
const exists = (p) => existsSync(path.join(root, p));
const platforms = Object.keys(doc.platforms);
const RANK = { missing: 0, na: 0, implemented: 1, verified: 2 };
const LIMIT = { static: 1, verified: 2 };

// 1. Feature directories: declared == present, per platform.
for (const p of platforms) {
  // A platform may have several roots (web: the app and admin projects each own modules).
  const dirs = [].concat(doc.feature_roots[p] ?? []);
  const bad = dirs.filter((d) => !exists(d));
  if (!dirs.length || bad.length) { fail(`feature_roots.${p}: ${bad.join(', ') || 'missing'} does not exist`); continue; }
  const declared = new Set(Object.values(doc.features).map((f) => f[p]).filter(Boolean));
  if (p === 'server') Object.keys(doc.server_only_modules ?? {}).forEach((m) => declared.add(m));
  const present = dirs.flatMap((dir) => readdirSync(path.join(root, dir)).filter((n) => statSync(path.join(root, dir, n)).isDirectory()).map((n) => ({ dir, n })));
  const prefix = doc.feature_prefix?.[p]; // a root shared with non-feature directories (desktop crates)
  for (const { dir, n } of present) if (!declared.has(n) && (!prefix || n.startsWith(prefix))) fail(`${p}: undeclared feature directory ${dir}/${n} (add it to features.yaml)`);
  for (const n of declared) if (!present.some((x) => x.n === n)) fail(`${p}: features.yaml declares ${n} but it does not exist under ${dirs.join(' or ')}`);
}
for (const [name, f] of Object.entries(doc.features))
  for (const p of platforms) if (f[p] === undefined) fail(`feature ${name}: no entry for platform ${p}`);

// 2. Behaviours.
for (const [name, b] of Object.entries(doc.behaviors)) {
  if (!b.fixtures || !exists(b.fixtures)) fail(`behavior ${name}: fixtures file ${b.fixtures} does not exist`);
  for (const p of platforms) {
    const e = b.platforms?.[p];
    if (!e) { fail(`behavior ${name}: no entry for platform ${p}`); continue; }
    const where = `behavior ${name} on ${p}`;
    if (!(e.status in RANK)) { fail(`${where}: unknown status ${e.status}`); continue; }
    if (e.status === 'na' && !e.reason) fail(`${where}: na needs reason`);
    if (e.status === 'missing') { if (!e.tracking) fail(`${where}: missing needs tracking`); gaps.push(`${name} @ ${p}`); }
    if (e.status === 'implemented' || e.status === 'verified') {
      if (!e.evidence) fail(`${where}: ${e.status} needs evidence`);
      else if (!exists(e.evidence)) fail(`${where}: evidence ${e.evidence} does not exist`);
      if (RANK[e.status] > LIMIT[doc.platforms[p].verification])
        fail(`${where}: claims ${e.status} but platform verification is ${doc.platforms[p].verification}`);
    }
  }
}

// 3. Shape: layers, locale catalogs, tests, navigation entry, plugin ids, flagged set, outbox types, namespaces, routes.
errors.push(...checkShape(root, doc, JSON.parse(readFileSync(path.join(root, 'docs', 'contract', 'behavior', 'offline-outbox.json'), 'utf8')).knownTypes).errors);

if (args.has('--require-complete') && gaps.length) fail(`${gaps.length} behaviour gap(s) remain: ${gaps.join(', ')}`);

if (args.has('--json')) console.log(JSON.stringify({ errors, gaps }, null, 2));
else {
  console.log(`features.yaml: ${Object.keys(doc.features).length} features x ${platforms.length} platforms, ${Object.keys(doc.behaviors).length} behaviours`);
  console.log(`gaps (missing): ${gaps.length}${gaps.length ? '\n  ' + gaps.join('\n  ') : ''}`);
  if (errors.length) console.error('\nFAIL:\n  ' + errors.join('\n  '));
  else console.log('OK: features.yaml matches the tree.');
}
process.exit(errors.length ? 1 : 0);

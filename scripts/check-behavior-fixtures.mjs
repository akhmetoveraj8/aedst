#!/usr/bin/env node
// Replays every shared behaviour fixture (docs/contract/behavior/*.json) against the reference model in
// scripts/behavior/model.mjs. Proves the fixtures agree with their written rules; platform tests then replay
// the same files against real code. Usage: node scripts/check-behavior-fixtures.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCapabilities, runErrorKind, runGate, runOutbox, runSession, validateErrorKinds } from './behavior/model.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'contract', 'behavior');
const load = (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
const problems = [];
let cases = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const outbox = load('offline-outbox.json');
for (const c of outbox.cases) {
  cases++;
  for (const f of runOutbox(outbox, c.steps)) problems.push(`offline-outbox/${c.id}: ${f}`);
}
for (const c of load('session-refresh.json').cases) {
  cases++;
  const got = runSession(c);
  if (!same(got, c.expect)) problems.push(`session-refresh/${c.id}: got ${JSON.stringify(got)} expected ${JSON.stringify(c.expect)}`);
}
const gate = load('client-version-gate.json');
for (const c of gate.cases) {
  cases++;
  const got = runGate(gate, c);
  if (!same(got, c.expect)) problems.push(`client-version-gate/${c.id}: got ${JSON.stringify(got)} expected ${JSON.stringify(c.expect)}`);
}
const caps = load('capabilities.json');
for (const c of caps.cases) {
  cases++;
  const got = runCapabilities(caps, c);
  if (!same(got, c.expect)) problems.push(`capabilities/${c.id}: got ${JSON.stringify(got)} expected ${JSON.stringify(c.expect)}`);
}
const errorKinds = load('error-kinds.json');
for (const f of validateErrorKinds(errorKinds)) problems.push(`error-kinds: ${f}`);
for (const c of errorKinds.cases) {
  cases++;
  const got = runErrorKind(errorKinds, c);
  if (!same(got, c.expect)) problems.push(`error-kinds/${c.id}: got ${JSON.stringify(got)} expected ${JSON.stringify(c.expect)}`);
}

if (problems.length) {
  console.error(`FAIL: ${problems.length} fixture problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`OK: ${cases} behaviour cases agree with the reference model.`);

// node --test scripts/test/check-features-shape.test.mjs
// Runs the shape checks of scripts/features/shape.mjs on the real tree with a mutated copy of features.yaml and
// proves each class of drift is reported (and that the committed declarations are clean).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkShape } from '../features/shape.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { parse } = createRequire(import.meta.url)('yaml');
const load = () => parse(readFileSync(path.join(root, 'features.yaml'), 'utf8'));
const known = JSON.parse(readFileSync(path.join(root, 'docs/contract/behavior/offline-outbox.json'), 'utf8')).knownTypes;
const errorsOf = (doc) => checkShape(root, doc, known).errors;

test('the committed features.yaml has no shape errors', () => {
  assert.deepEqual(errorsOf(load()), []);
});

test('a flagged declaration that differs from the clients is reported on every client', () => {
  const doc = load();
  doc.features.tasks.flagged = true;
  const errors = errorsOf(doc);
  for (const p of ['web', 'android', 'apple', 'desktop']) assert.ok(errors.some((e) => e.startsWith(`${p}: flagged set`)), p);
});

test('an outbox type missing from the declaration or from knownTypes is reported', () => {
  const doc = load();
  doc.features.tasks.outbox = ['task.create'];
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.startsWith('tasks on web: outbox types')));
  assert.ok(errors.some((e) => e.includes('knownTypes')));
});

test('a removed exception surfaces the real deviation', () => {
  const doc = load();
  doc.exceptions = doc.exceptions.filter((e) => !(e.feature === 'auth' && e.platform === 'desktop'));
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.startsWith('auth on desktop: data:')));
});

test('a stale exception, one without a reason and one naming no check are reported', () => {
  const doc = load();
  doc.exceptions.push({ feature: 'tasks', platform: 'web', skip: ['ui'], reason: 'tasks has a ui directory' });
  doc.exceptions.push({ feature: 'search', platform: 'apple', skip: ['tests'] });
  doc.exceptions.push({ feature: 'search', platform: 'apple', skip: ['nonsense'], reason: 'x' });
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes('tasks on web: exception for ui is stale')));
  assert.ok(errors.some((e) => e.includes('needs feature, platform, skip[] and reason')));
  assert.ok(errors.some((e) => e.includes('search/apple/nonsense matches no check')));
});

test('missing per-feature declarations and wrong web routes or namespace are reported', () => {
  const doc = load();
  delete doc.features.search.routes;
  doc.features.admin.routes = ['/nope'];
  doc.features.auth.i18n_namespace = 'other';
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => e.includes('feature search: missing declaration `routes`')));
  assert.ok(errors.some((e) => e.includes('feature admin: web manifest routes')));
  assert.ok(errors.some((e) => e.includes('feature auth: web manifest i18nNamespaces')));
});

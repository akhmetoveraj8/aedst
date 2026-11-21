// node --test scripts/test/new-feature-web.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { featureForms, scaffoldWebFeature } from '../new-feature-web.mjs';

const quiet = () => {};
const PUBLIC = [
  '/** Public surface. */',
  '',
  'export { DemoList } from "@/modules/demo/features/alpha/ui/demo-list";',
  'export { DemoZed } from "@/modules/demo/features/zed/ui/demo-zed";',
  '',
].join('\n');

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'aedst-new-feature-'));
  const module = path.join(root, 'apps/web/app/src/modules/demo');
  mkdirSync(path.join(module, 'i18n'), { recursive: true });
  writeFileSync(path.join(module, 'manifest.ts'), 'export const manifest = { id: "demo" };\n');
  writeFileSync(path.join(module, 'public.ts'), PUBLIC);
  for (const locale of ['en', 'ru', 'tj', 'uz', 'ar']) {
    writeFileSync(path.join(module, 'i18n', `${locale}.json`), '{\n  "title": "Demo"\n}\n');
  }
  return { root, module };
}

describe('new-feature (web)', () => {
  const { root, module } = makeRoot();
  after(() => rmSync(root, { recursive: true, force: true }));

  it('derives the name forms', () => {
    assert.deepEqual(featureForms('demo', 'bulk-edit'), { module: 'demo', feature: 'bulk-edit', Feature: 'BulkEdit', featureKey: 'bulkEdit' });
  });

  it('stamps a feature, exports it in sort order and adds the key to all five locales', () => {
    const result = scaffoldWebFeature({ module: 'demo', name: 'bulk-edit', root, log: quiet });
    assert.ok(result.files.every((file) => file.includes('/features/bulk-edit/ui/')));
    const view = readFileSync(path.join(module, 'features/bulk-edit/ui/bulk-edit-view.tsx'), 'utf8');
    assert.match(view, /export function BulkEditView\(\)/);
    assert.match(view, /useTranslations\("demo\.bulkEdit"\)/);
    const lines = readFileSync(path.join(module, 'public.ts'), 'utf8').split('\n');
    assert.equal(lines[3], 'export { BulkEditView } from "@/modules/demo/features/bulk-edit/ui/bulk-edit-view";');
    for (const locale of ['en', 'ru', 'tj', 'uz', 'ar']) {
      const catalogue = JSON.parse(readFileSync(path.join(module, 'i18n', `${locale}.json`), 'utf8'));
      assert.deepEqual(catalogue.bulkEdit, { title: 'Bulk edit' });
    }
  });

  it('refuses an existing feature, an unknown module and a bad name', () => {
    assert.throws(() => scaffoldWebFeature({ module: 'demo', name: 'bulk-edit', root, log: quiet }), /already exists/);
    assert.throws(() => scaffoldWebFeature({ module: 'nope', name: 'x1', root, log: quiet }), /does not exist/);
    assert.throws(() => scaffoldWebFeature({ module: 'demo', name: 'BulkEdit', root, log: quiet }), /kebab-case/);
    assert.throws(() => scaffoldWebFeature({ module: 'demo', name: 'ui', root, log: quiet }), /reserved/);
    assert.throws(() => scaffoldWebFeature({ module: 'demo', name: 'x1', project: 'landing', root, log: quiet }), /unknown web project/);
  });

  it('--remove restores the module byte for byte', () => {
    scaffoldWebFeature({ module: 'demo', name: 'bulk-edit', root, remove: true, log: quiet });
    assert.equal(existsSync(path.join(module, 'features')), false);
    assert.equal(readFileSync(path.join(module, 'public.ts'), 'utf8'), PUBLIC);
    assert.equal(readFileSync(path.join(module, 'i18n/ar.json'), 'utf8'), '{\n  "title": "Demo"\n}\n');
  });
});

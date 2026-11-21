// node --test scripts/test/new-feature.test.mjs
// The shared `task new:feature` CLI and its server part, against a throwaway tree. The web part has
// its own test (new-feature-web.test.mjs); here it is only reached through the platform hook.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { FEATURE_PLATFORMS, parseArgs, scaffoldFeature, scaffoldServerFeature, serverFeatureName } from '../new-feature.mjs';

const quiet = () => {};
// Mirrors featureLayers in apps/server/architecturetest/features_test.go.
const LAYERS = ['application', 'domain', 'infrastructure', 'transport'];

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'aedst-new-feature-server-'));
  const module = path.join(root, 'apps/server/internal/modules/demo');
  for (const dir of ['api', 'domain', 'module']) mkdirSync(path.join(module, dir), { recursive: true });
  writeFileSync(path.join(module, 'module/module.go'), 'package module\n');
  return { root, module };
}

describe('new-feature (server)', () => {
  const { root, module } = makeRoot();
  after(() => rmSync(root, { recursive: true, force: true }));

  it('turns the feature id into a Go package path element', () => {
    assert.equal(serverFeatureName('bulk-edit'), 'bulkedit');
    assert.equal(serverFeatureName('archive'), 'archive');
  });

  it('dry-run writes nothing', () => {
    const result = scaffoldServerFeature({ module: 'demo', name: 'archive', root, dryRun: true, log: quiet });
    assert.ok(result.files.length >= 2);
    assert.equal(existsSync(path.join(module, 'features')), false);
  });

  it('stamps only known layers, with the module and feature substituted', () => {
    const result = scaffoldServerFeature({ module: 'demo', name: 'bulk-edit', root, log: quiet });
    assert.deepEqual(result.edited, []);
    assert.ok(result.files.every((file) => file.startsWith('apps/server/internal/modules/demo/features/bulkedit/')));
    const feature = path.join(module, 'features/bulkedit');
    for (const entry of readdirSync(feature, { withFileTypes: true })) {
      assert.ok(entry.isDirectory() && LAYERS.includes(entry.name), `${entry.name} is not a feature layer`);
    }
    const service = readFileSync(path.join(feature, 'application/service.go'), 'utf8');
    assert.match(service, /^package application$/m);
    assert.match(service, /demo module's bulkedit\n\/\/ feature/);
    const test = readFileSync(path.join(feature, 'application/service_test.go'), 'utf8');
    assert.match(test, /"github\.com\/aedst\/server\/internal\/modules\/demo\/features\/bulkedit\/application"/);
    for (const text of [service, test]) assert.doesNotMatch(text, /\{\{|__feature__/);
    // A feature imports the module's shared packages, never another feature and never module/.
    for (const text of [service, test]) assert.doesNotMatch(text, /modules\/demo\/(features\/(?!bulkedit\/)|module")/);
  });

  it('refuses an existing feature, an unknown module and bad or reserved names', () => {
    assert.throws(() => scaffoldServerFeature({ module: 'demo', name: 'bulk-edit', root, log: quiet }), /already exists/);
    assert.throws(() => scaffoldServerFeature({ module: 'demo', name: 'bulkedit', root, log: quiet }), /already exists/);
    assert.throws(() => scaffoldServerFeature({ module: 'nope', name: 'archive', root, log: quiet }), /does not exist/);
    assert.throws(() => scaffoldServerFeature({ name: 'archive', root, log: quiet }), /MODULE is required/);
    for (const bad of ['Archive', 'bulk_edit', '1st', 'a', '-x', 'x'.repeat(30)]) {
      assert.throws(() => scaffoldServerFeature({ module: 'demo', name: bad, root, log: quiet }), /NAME/, bad);
    }
    for (const reserved of ['application', 'domain', 'infrastructure', 'transport', 'api', 'module', 'features']) {
      assert.throws(() => scaffoldServerFeature({ module: 'demo', name: reserved, root, log: quiet }), /reserved/, reserved);
    }
  });

  it('--remove deletes an untouched stamp and keeps a feature someone edited', () => {
    scaffoldServerFeature({ module: 'demo', name: 'bulk-edit', root, remove: true, log: quiet });
    assert.equal(existsSync(path.join(module, 'features')), false);
    assert.equal(existsSync(path.join(module, 'module/module.go')), true);

    scaffoldServerFeature({ module: 'demo', name: 'archive', root, log: quiet });
    mkdirSync(path.join(module, 'features/archive/infrastructure/postgres'), { recursive: true });
    writeFileSync(path.join(module, 'features/archive/infrastructure/postgres/postgres.go'), 'package postgres\n');
    assert.throws(() => scaffoldServerFeature({ module: 'demo', name: 'archive', root, remove: true, log: quiet }), /refusing to remove/);
    assert.equal(existsSync(path.join(module, 'features/archive/application/service.go')), true);
  });
});

describe('new-feature (shared CLI)', () => {
  it('parses MODULE, NAME and the flags', () => {
    assert.deepEqual(parseArgs(['MODULE=tasks', 'NAME=bulk-edit', '--platforms=server,web', '--project=admin', '--dry-run', '--remove']), {
      module: 'tasks',
      name: 'bulk-edit',
      platforms: ['server', 'web'],
      project: 'admin',
      dryRun: true,
      remove: true,
    });
    assert.throws(() => parseArgs(['--nope']), /unknown argument/);
  });

  it('stamps the server by default and rejects a platform without a hook', async () => {
    const { root, module } = makeRoot();
    try {
      const result = await scaffoldFeature({ module: 'demo', name: 'archive', root, log: quiet });
      assert.deepEqual(Object.keys(result), ['server']);
      assert.equal(existsSync(path.join(module, 'features/archive/application/service.go')), true);
      await assert.rejects(scaffoldFeature({ module: 'demo', name: 'other', platforms: ['android'], root, log: quiet }), /unknown platform/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('has a web hook that hands MODULE and NAME to the web part', async () => {
    assert.ok(FEATURE_PLATFORMS.includes('web'));
    const { root } = makeRoot();
    try {
      // No web module in this tree: the error must come from the web part, which proves the hook reached it.
      await assert.rejects(scaffoldFeature({ module: 'demo', name: 'archive', platforms: ['web'], root, log: quiet }), /does not exist in app/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// node --test scripts/new-module.test.mjs   (task test:scaffold)
// Copies the files new:module touches into a temp git repo, stamps a module there, and runs the cheap checks
// that need no toolchain (i18n parity, features.yaml, naming) against the copy. The real tree is never written.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { PLATFORMS, forms, scaffold, validateName } from './new-module.mjs';
import { registryEdits } from './new-module-registries.mjs';

const REAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = () => {};
let tmp;

const git = (...args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8' });
const node = (script, ...args) => execFileSync('node', [script, ...args], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' });

/**
 * features.yaml check on the copy: the behaviour evidence files are not copied and the client builds / shape checks
 * (scripts/features/shape.mjs) need the whole tree, so only feature-directory drift counts.
 */
function featureDrift() {
  try {
    node('scripts/check-features.mjs');
    return [];
  } catch (err) {
    return String(err.stderr)
      .split('\n')
      .filter((l) => /^\s*\w+: (undeclared feature directory|features\.yaml declares)/.test(l));
  }
}

/** Copy the registry files and the existing `tasks` module trees (the checks compare against them). */
function seed() {
  const paths = new Set(['features.yaml', 'scripts/check-i18n-parity.mjs', 'scripts/check-features.mjs', 'scripts/features/shape.mjs', 'docs/contract/behavior/offline-outbox.json', 'scripts/check-naming.sh', 'scripts/package.json']);
  for (const e of registryEdits(forms('probe'))) paths.add(e.file);
  paths.add('apps/server/internal/modules');
  paths.add('apps/web/app/src/modules');
  paths.add('apps/web/app/src/app/config/i18n/common');
  paths.add('apps/web/admin/src/modules');
  paths.add('apps/web/admin/src/app/config/i18n/common');
  paths.add('apps/web/landing/src/modules');
  paths.add('apps/web/landing/src/app/config/i18n/common');
  paths.add('apps/apple/scripts');
  paths.add('apps/android/feature');
  paths.add('apps/apple/Features');
  paths.add('apps/desktop/Modules/Features');
  for (const p of paths) {
    const src = path.join(REAL, p);
    if (!existsSync(src)) continue;
    cpSync(src, path.join(tmp, p), { recursive: true, filter: (f) => !/[\\/](build|node_modules|\.gradle|\.next)([\\/]|$)/.test(f) });
  }
  cpSync(path.join(REAL, 'scripts/node_modules'), path.join(tmp, 'scripts/node_modules'), { recursive: true });
  cpSync(path.join(REAL, 'scripts/behavior'), path.join(tmp, 'scripts/behavior'), { recursive: true });
}

describe('validateName', () => {
  it('accepts one lowercase word and rejects the rest', () => {
    assert.equal(validateName('sample', REAL), null);
    for (const bad of ['', 'Sample', 'my-module', 'my_module', '1abc', 'a', 'tasks', 'platform', 'x'.repeat(30)]) {
      assert.notEqual(validateName(bad, REAL), null, bad);
    }
  });
});

describe('scaffold in a temp copy', () => {
  before(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'aedst-newmodule-'));
    seed();
    git('init', '-q');
    git('add', '-A');
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  it('dry-run writes nothing', () => {
    const before = git('status', '--porcelain');
    scaffold({ name: 'zeta', root: tmp, dryRun: true, log: quiet });
    assert.equal(git('status', '--porcelain'), before);
  });

  it('stamps every platform, registers it once, and the cheap checks pass', () => {
    const first = scaffold({ name: 'zeta', root: tmp, codegen: false, log: quiet });
    assert.ok(first.files.length > 40);
    for (const p of PLATFORMS) assert.ok(first.files.some((f) => f.startsWith(`apps/${p}/`)), p);
    assert.match(readFileSync(path.join(tmp, 'apps/server/cmd/server/modules.go'), 'utf8'), /modules\/zeta\/module"/);
    assert.match(readFileSync(path.join(tmp, 'apps/server/architecturetest/layers_test.go'), 'utf8'), /"tasks", "zeta"\}/);
    git('add', '-A');
    node('scripts/check-i18n-parity.mjs');
    assert.deepEqual(featureDrift(), []);
    execFileSync('bash', ['scripts/check-naming.sh'], { cwd: tmp, stdio: 'pipe' });
  });

  it('refuses to overwrite and keeps registries idempotent', () => {
    assert.throws(() => scaffold({ name: 'zeta', root: tmp, codegen: false, log: quiet }), /already exists|refusing to overwrite/);
    const regs = registryEdits(forms('zeta'));
    for (const e of regs) {
      const text = readFileSync(path.join(tmp, e.file), 'utf8');
      assert.equal(e.add(text), text, `${e.file} add is not idempotent`);
    }
  });

  it('--remove undoes every file and registry line', () => {
    git('add', '-A');
    const staged = git('diff', '--cached', '--name-only', '--', 'apps/server/internal/modules/zeta');
    assert.ok(staged.includes('zeta')); // tracked in the throwaway repo, so removal needs --force
    assert.throws(() => scaffold({ name: 'zeta', root: tmp, remove: true, log: quiet }), /refusing to remove/);
    scaffold({ name: 'zeta', root: tmp, remove: true, force: true, log: quiet });
    for (const dir of ['apps/server/internal/modules/zeta', 'apps/web/app/src/modules/zeta', 'apps/android/feature/zeta', 'apps/apple/Features/Zeta', 'apps/desktop/Modules/Features/Zeta']) {
      assert.equal(existsSync(path.join(tmp, dir)), false, dir);
    }
    git('add', '-A');
    assert.deepEqual(featureDrift(), []);
    assert.equal(readFileSync(path.join(tmp, 'features.yaml'), 'utf8').includes('zeta'), false);
    assert.equal(readFileSync(path.join(tmp, 'apps/server/sqlc.yaml'), 'utf8').includes('zeta'), false);
  });

  it('a partial platform set leaves features.yaml alone', () => {
    const result = scaffold({ name: 'omega', platforms: ['web'], root: tmp, codegen: false, log: quiet });
    assert.equal(result.registry.includes('features.yaml'), false);
    assert.ok(result.files.every((f) => f.startsWith('apps/web/')));
    mkdirSync(tmp, { recursive: true });
  });
});

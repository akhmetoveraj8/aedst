// node --test scripts/test/template-new.test.mjs
// Runs scripts/template-new.mjs on COPIES of the repository (never in place) for every profile,
// then runs the cheap gates inside each copy. The `full` copy is the baseline: a gate may only
// fail in a smaller profile if it also fails in `full` (pre-existing, owned by someone else).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = path.join(REPO, 'scripts', 'template-new.mjs');
const PROFILES = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'template-profiles.json'), 'utf8')).profiles;
const BASE = fs.mkdtempSync(path.join(process.env.TEMPLATE_TEST_DIR ?? os.tmpdir(), 'template-new-test-'));
const hasGit = spawnSync('git', ['--version']).status === 0;
const hasBash = spawnSync('bash', ['--version']).status === 0;
const ALL = ['android', 'apple', 'desktop'];
const NAME = 'Acme Cloud';

const run = (cwd, cmd, args) => spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tool = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

function textFiles(root) {
  const out = run(root, 'git', ['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  return out.filter((f) => fs.existsSync(path.join(root, f)) && !fs.readFileSync(path.join(root, f)).subarray(0, 8000).includes(0));
}

function generatedSkip(root) {
  const globs = [/^docs\/archive\//, /^CHANGELOG\.md$/, /\.proto$/, /\.lock$/, /pnpm-lock\.yaml$/, /go\.sum$/, /Package\.resolved$/];
  for (const line of read(root, 'scripts/file-size.config').split('\n')) {
    const m = /^exclude\s+(\S+)/.exec(line);
    if (m) globs.push(new RegExp(`^${m[1].replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')}$`));
  }
  return (f) => globs.some((g) => g.test(f));
}

const cases = new Map();
function prepare(profile) {
  const dir = path.join(BASE, profile);
  const r = tool('--name', NAME, '--profile', profile, '--out', dir);
  assert.equal(r.status, 0, `template-new failed:\n${r.stdout}\n${r.stderr}`);
  if (hasGit) {
    run(dir, 'git', ['init', '-q', '.']);
    run(dir, 'git', ['add', '-A', '.']);
  }
  if (fs.existsSync(path.join(REPO, 'scripts', 'node_modules'))) fs.cpSync(path.join(REPO, 'scripts', 'node_modules'), path.join(dir, 'scripts', 'node_modules'), { recursive: true });
  return { dir, out: r.stdout };
}

const GATES = [
  ['naming', 'bash', ['scripts/check-naming.sh']],
  ['file-size', 'bash', ['scripts/check-file-size.sh']],
  ['colors', process.execPath, ['scripts/check-color-literals.mjs']],
  ['i18n', process.execPath, ['scripts/check-i18n-parity.mjs']],
  ['boundaries', 'bash', ['scripts/check-boundaries.sh', 'web', 'android', 'apple', 'desktop']],
  ['features', process.execPath, ['scripts/check-features.mjs']],
  ['behavior', process.execPath, ['scripts/check-behavior-fixtures.mjs']],
];

const gateResults = new Map();
function gate(profile, name) {
  const key = `${profile}/${name}`;
  if (!gateResults.has(key)) {
    const [, cmd, args] = GATES.find((g) => g[0] === name);
    gateResults.set(key, run(cases.get(profile).dir, cmd, args));
  }
  return gateResults.get(key);
}

const docsViolations = (profile) => {
  const r = run(cases.get(profile).dir, process.execPath, ['scripts/check-docs.mjs']);
  return new Set(`${r.stdout}\n${r.stderr}`.split('\n').filter((l) => /\[(links|paths|prompts|cyrillic)\]/.test(l)).map((l) => l.replace(/^[^:]+:\d+: /, '')));
};

before(() => { for (const p of Object.keys(PROFILES)) cases.set(p, prepare(p)); });
after(() => fs.rmSync(BASE, { recursive: true, force: true }));

describe('cli safety', () => {
  test('refuses to run without --out, --in-place or --dry-run', () => {
    assert.equal(tool('--name', NAME, '--profile', 'core').status, 2);
  });
  test('rejects bad names, unknown profiles and a non-empty --out', () => {
    assert.equal(tool('--name', 'bad/name', '--profile', 'core', '--dry-run').status, 2);
    assert.equal(tool('--name', 'aedst', '--profile', 'core', '--dry-run').status, 2);
    assert.equal(tool('--name', NAME, '--profile', 'huge', '--dry-run').status, 2);
    assert.equal(tool('--name', NAME, '--profile', 'core', '--out', cases.get('core').dir).status, 2);
  });
  test('--dry-run leaves the source tree untouched', () => {
    const probe = ['Taskfile.yml', 'README.md', 'renovate.json'].map((f) => [f, fs.statSync(path.join(REPO, f)).mtimeMs]);
    const r = tool('--name', NAME, '--profile', 'core', '--dry-run');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /dry run: nothing was written/);
    for (const [f, m] of probe) assert.equal(fs.statSync(path.join(REPO, f)).mtimeMs, m, f);
    assert.ok(fs.existsSync(path.join(REPO, 'apps', 'server')));
  });
});

for (const profile of Object.keys(PROFILES)) {
  const removed = PROFILES[profile].remove;
  const kept = ALL.filter((p) => !removed.includes(p));

  describe(`profile ${profile}`, () => {
    test('removed platforms are gone, kept ones remain', () => {
      const { dir } = cases.get(profile);
      for (const p of removed) {
        assert.ok(!exists(dir, `apps/${p}`), `apps/${p} should be removed`);
        assert.ok(!exists(dir, `docs/content/${p}`), `docs/content/${p} should be removed`);
      }
      for (const p of ['server', 'web', ...kept]) assert.ok(exists(dir, `apps/${p}`), `apps/${p} should remain`);
      assert.ok(!exists(dir, 'scripts/template-new.mjs'), 'tool is removed after use');
    });

    test('no removed platform is referenced by Taskfile, workflows, INDEX, CODEOWNERS, renovate, lefthook, features, configs', () => {
      const { dir } = cases.get(profile);
      const files = ['Taskfile.yml', 'lefthook.yml', 'renovate.json', 'features.yaml', '.github/CODEOWNERS', 'docs/agent/INDEX.md', 'scripts/file-size.config', 'scripts/i18n-parity.allowlist', 'scripts/color-literals.allowlist']
        .concat(fs.readdirSync(path.join(dir, '.github/workflows')).map((f) => `.github/workflows/${f}`));
      for (const p of removed) {
        const re = new RegExp(`apps/${p}\\b|(^|[\\s"'])${p}:[a-z]|\\b${p}-(ci|release|nightly|beta)\\b|^\\|\\s*${p}\\s*\\|`, 'im');
        for (const f of files) if (exists(dir, f)) assert.doesNotMatch(read(dir, f), re, `${f} still references ${p}`);
      }
      for (const p of kept) assert.match(read(dir, 'Taskfile.yml'), new RegExp(`^  ${p}:`, 'm'), `Taskfile lost ${p} tasks`);
    });

    test('edited JSON and YAML stay valid; every `task:` reference resolves', async () => {
      const { dir } = cases.get(profile);
      for (const f of ['renovate.json', 'scripts/package.json']) JSON.parse(read(dir, f));
      let YAML;
      try { YAML = await import('yaml'); } catch { return; /* scripts/node_modules not installed */ }
      const parse = (f) => YAML.parse(read(dir, f));
      for (const f of ['lefthook.yml', 'features.yaml']) assert.ok(parse(f), f);
      for (const w of fs.readdirSync(path.join(dir, '.github/workflows'))) assert.ok(parse(`.github/workflows/${w}`), w);
      const tf = parse('Taskfile.yml');
      const names = new Set([...Object.keys(tf.tasks), ...fs.readdirSync(path.join(dir, 'apps/server')).includes('Taskfile.yml') ? Object.keys(parse('apps/server/Taskfile.yml').tasks).map((t) => `server:${t}`) : []]);
      const refs = [...JSON.stringify(tf.tasks).matchAll(/"task":"([^"]+)"/g)].map((m) => m[1]);
      for (const r of refs) assert.ok(names.has(r) || r.startsWith('server:'), `Taskfile references unknown task ${r}`);
      const features = parse('features.yaml');
      assert.deepEqual(Object.keys(features.platforms).sort(), ['server', 'web', ...kept].sort());
      const rn = JSON.parse(read(dir, 'renovate.json'));
      for (const m of removed.flatMap((p) => PROFILES && ({ android: ['gradle'], apple: ['swift', 'bundler'], desktop: ['vcpkg'] })[p])) assert.ok(!(rn.enabledManagers ?? []).includes(m), `renovate still enables ${m}`);
    });

    test('Taskfile is accepted by go-task (when installed)', (t) => {
      const probe = spawnSync('task', ['--version']);
      if (probe.status !== 0) return t.skip('task not installed');
      const r = run(cases.get(profile).dir, 'task', ['--list-all']);
      assert.equal(r.status, 0, r.stderr);
    });

    for (const [name] of GATES) {
      test(`gate ${name}`, (t) => {
        if (!hasGit || !hasBash) return t.skip('git/bash missing');
        const r = gate(profile, name);
        const base = gate('full', name);
        if (base.status !== 0) return t.diagnostic(`${name} already fails in full (baseline): ${base.status} ${(base.stdout + base.stderr).slice(-400)}`);
        else assert.equal(r.status, 0, `${name} failed in ${profile}:\n${r.stdout.slice(-1500)}\n${r.stderr.slice(-500)}`);
      });
    }

    test('check-docs adds no violation beyond the full-profile baseline', (t) => {
      if (!exists(cases.get(profile).dir, 'scripts/check-docs.mjs')) return t.skip('scripts/check-docs.mjs not present');
      const base = docsViolations('full');
      const extra = [...docsViolations(profile)].filter((v) => !base.has(v));
      assert.deepEqual(extra, [], `new docs violations:\n${extra.join('\n')}`);
    });

    test('external identifiers are renamed; the internal codename is kept', () => {
      const { dir } = cases.get(profile);
      const skip = generatedSkip(dir);
      const forbidden = [
        /com\.aedst\.(apple|Desktop)\b/, /applicationId\s*=\s*"com\.aedst\./, /aedst-(server|desktop)\b/, /\baedst_session/,
        /(?<!com\.)(?<!\w)aedst\.(dev|com|app|example)\b/, /ghcr\.io\/aedst\//, /(?<!\w)AEDST(?!\w)/,
      ];
      const hits = [];
      for (const f of textFiles(dir)) {
        if (skip(f)) continue;
        const text = read(dir, f);
        for (const re of forbidden) if (re.test(text)) hits.push(`${f}: ${re}`);
        for (const re of forbidden.slice(0, 7)) if (re.test(f)) hits.push(`${f} (path): ${re}`);
      }
      assert.deepEqual(hits, [], `external identifiers left:\n${hits.slice(0, 20).join('\n')}`);
      assert.match(read(dir, 'apps/server/go.mod'), /^module github\.com\/aedst\//m, 'Go import path is the permanent codename');
      assert.ok(fs.readdirSync(path.join(dir, 'apps/server/api/proto')).includes('aedst'), 'proto packages keep aedst.*');
      assert.ok(exists(dir, 'apps/server/deployments/helm/acme-cloud-server'), 'Helm chart directory renamed');
      assert.match(read(dir, 'apps/web/shared/lib/auth/session-cookies.ts'), /acme_cloud_session/);
      assert.match(read(dir, 'apps/web/app/src/app/config/seo.ts'), /name: "Acme Cloud"/);
    });
  });
}

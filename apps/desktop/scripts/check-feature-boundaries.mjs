// Crate boundaries of apps/desktop, checked on the manifests and sources (no cargo needed).
// Rules, layout and the allowlist: docs/content/desktop/boundaries.md. Entry point: check-feature-boundaries.sh.
//
//   D1  an `aedst-feature-*` crate never depends on another feature crate (Cargo.toml, any dependency kind)
//   D2  a feature depends only on the allowed core crates (FEATURE_MAY_USE; FEATURE_TESTS_MAY_USE for dev)
//   D3  the same at source level: `aedst_<crate>` paths and `../aedst-<crate>` build paths in a feature
//   D4  only the `aedst-desktop` binary composes features: no other crate names a feature in Cargo.toml,
//       Rust code, a Slint import or build.rs (so a core crate never depends on a feature)
//   D5  a feature `.slint` imports only its own `ui/` files and `@aedst-ui`; from `std-widgets.slint` only
//       `ListView` (lazy rows need a `for` directly inside it, so the kit cannot wrap it; slint-rules M1)
//   D6  layout: a feature crate is flat (one capability: `src/{domain,data,presentation}`, `ui/*.slint`)
//       or split (`src/<feature>/{domain,data,presentation}`, `ui/<feature>/`, shared code in `src/shared`
//       and `ui/shared`), never both; split features do not import each other and `shared` imports none
//
// Usage: node check-feature-boundaries.mjs [--self-test] [ROOT]   (ROOT defaults to apps/desktop)

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  directDependencies,
  matchesWithLines,
  readManifest,
  stripComments,
  subdirectories,
  walk,
} from '../../../scripts/rust/cargo-manifest.mjs';

const SHELL = 'aedst-desktop';
const FEATURE = /^aedst-feature-/;
// Derived from the dependency graph of 2026-11-21. Extending either list is a decision: change it here and in
// docs/content/desktop/boundaries.md in the same change.
export const FEATURE_MAY_USE = ['aedst-api', 'aedst-common', 'aedst-contract', 'aedst-outbox', 'aedst-slint-model'];
export const FEATURE_TESTS_MAY_USE = ['aedst-persistence'];
// The kit is reached from Slint (`@aedst-ui`) and from build.rs (`../aedst-ui/ui/lib.slint`), not as a Rust dependency.
const KIT = 'aedst-ui';
const LAYERS = ['domain', 'data', 'presentation'];
const SHARED = 'shared';
const SLINT_IMPORT = /\b(?:import|export)\b[^;"]*"([^"]+)"/g;
// The only std-widgets import a feature may have (docs/content/desktop/slint-rules.md, M1).
const LISTVIEW_ONLY = /^import\s*\{\s*ListView\s*\}\s*from\s*"std-widgets\.slint"$/;

const posix = (file) => file.split(path.sep).join('/');
const snake = (crate) => crate.replaceAll('-', '_');

function loadCrates(root) {
  const workspace = readManifest(path.join(root, 'Cargo.toml')).workspace ?? {};
  const excluded = new Set((workspace.exclude ?? []).map((entry) => path.basename(entry)));
  return subdirectories(path.join(root, 'crates'))
    .filter((dir) => !excluded.has(dir) && existsSync(path.join(root, 'crates', dir, 'Cargo.toml')))
    .map((dir) => {
      const base = path.join(root, 'crates', dir);
      const manifest = readManifest(path.join(base, 'Cargo.toml'));
      return { name: manifest.package?.name ?? dir, dir: base, deps: directDependencies(manifest) };
    });
}

const isInternal = (dep) => dep.spec.path !== undefined || dep.name.startsWith('aedst-');

/** Comment-free text of every `.rs` / `.slint` file of a crate, with its path relative to the crate. */
function sources(crate, extension) {
  return walk(crate.dir, [extension]).map((file) => ({
    file,
    rel: posix(path.relative(crate.dir, file)),
    code: stripComments(readFileSync(file, 'utf8')),
  }));
}

function checkFeatureDependencies(crate, names, report) {
  const manifest = path.join(crate.dir, 'Cargo.toml');
  for (const dep of crate.deps.filter(isInternal)) {
    if (FEATURE.test(dep.name)) {
      report('D1', manifest, `${crate.name} depends on another feature crate: ${dep.name}`);
    } else if (dep.kind === 'dev' ? ![...FEATURE_MAY_USE, ...FEATURE_TESTS_MAY_USE].includes(dep.name) : !FEATURE_MAY_USE.includes(dep.name)) {
      report('D2', manifest, `${crate.name} may not depend on ${dep.name} as a ${dep.kind} dependency (allowed: ${FEATURE_MAY_USE.join(', ')}; tests also ${FEATURE_TESTS_MAY_USE.join(', ')})`);
    }
  }
  const bySnake = new Map(names.map((name) => [snake(name), name]));
  for (const { file, rel, code } of sources(crate, '.rs')) {
    const isTest = rel.startsWith('tests/') || rel.startsWith('examples/');
    const allowed = new Set([crate.name, ...FEATURE_MAY_USE, ...(isTest ? FEATURE_TESTS_MAY_USE : [])]);
    for (const { line, match } of matchesWithLines(code, /\baedst_[a-z0-9_]+/g)) {
      const used = bySnake.get(match[0]);
      if (used && !allowed.has(used)) {
        report(FEATURE.test(used) ? 'D1' : 'D3', `${file}:${line}`, `${crate.name} uses ${match[0]} (${used} is not an allowed dependency of a feature${isTest ? '' : ' in production code'})`);
      }
    }
    for (const { line, match } of matchesWithLines(code, /\.\.\/(aedst-[a-z0-9-]+)/g)) {
      if (match[1] !== KIT && !allowed.has(match[1])) {
        report(FEATURE.test(match[1]) ? 'D1' : 'D3', `${file}:${line}`, `${crate.name} reaches into ${match[1]} by path`);
      }
    }
  }
}

function checkNotAFeatureUser(crate, report) {
  for (const dep of crate.deps) {
    if (FEATURE.test(dep.name)) {
      report('D4', path.join(crate.dir, 'Cargo.toml'), `${crate.name} depends on ${dep.name}; only ${SHELL} composes features`);
    }
  }
  for (const { file, rel, code } of sources(crate, '.rs')) {
    const pattern = rel === 'build.rs' ? /\baedst[-_]feature[-_][a-z0-9_-]+/g : /\baedst_feature_[a-z0-9_]+/g;
    for (const { line, match } of matchesWithLines(code, pattern)) {
      report('D4', `${file}:${line}`, `${crate.name} names ${match[0]}; only ${SHELL} composes features`);
    }
  }
  for (const { file, code } of sources(crate, '.slint')) {
    for (const { line, match } of matchesWithLines(code, SLINT_IMPORT)) {
      if (match[1].includes('aedst-feature-')) {
        report('D4', `${file}:${line}`, `${crate.name} imports a feature view (${match[1]}); only ${SHELL} composes features`);
      }
    }
  }
}

function checkFeatureSlint(crate, report) {
  const ui = path.join(crate.dir, 'ui');
  for (const { file, code } of sources(crate, '.slint')) {
    for (const { line, match } of matchesWithLines(code, SLINT_IMPORT)) {
      const target = match[1];
      if (target === 'std-widgets.slint') {
        if (!LISTVIEW_ONLY.test(match[0])) {
          report('D5', `${file}:${line}`, `raw std-widgets import in a feature; use an ${KIT} component (the kit wraps std-widgets; only \`import { ListView }\` is allowed)`);
        }
      } else if (target.startsWith('@')) {
        if (target !== `@${KIT}`) report('D5', `${file}:${line}`, `unknown Slint library ${target}; features import @${KIT} only`);
      } else if (path.relative(ui, path.resolve(path.dirname(file), target)).startsWith('..')) {
        report('D5', `${file}:${line}`, `${target} is outside this crate's ui/ folder`);
      }
    }
  }
}

/** D6. `flat`: only layer folders under src/ and no folder under ui/. `split`: only feature folders (+ shared). */
function checkLayout(crate, report) {
  const src = path.join(crate.dir, 'src');
  const ui = path.join(crate.dir, 'ui');
  const srcDirs = subdirectories(src);
  const uiDirs = subdirectories(ui);
  const layers = srcDirs.filter((dir) => LAYERS.includes(dir));
  const others = srcDirs.filter((dir) => !LAYERS.includes(dir));
  if (others.length === 0) {
    if (uiDirs.length > 0) report('D6', ui, `${crate.name} is flat (src/{${LAYERS.join(',')}}) but ui/ has folders: ${uiDirs.join(', ')}; a feature folder needs src/<feature>/ too`);
    return;
  }
  if (layers.length > 0) {
    report('D6', src, `${crate.name} mixes layer folders (${layers.join(', ')}) with feature folders (${others.join(', ')}); move every capability to src/<feature>/ and shared code to src/${SHARED}/`);
    return;
  }
  const features = others.filter((dir) => dir !== SHARED);
  for (const feature of features) {
    const extra = subdirectories(path.join(src, feature)).filter((dir) => !LAYERS.includes(dir));
    if (extra.length > 0) report('D6', path.join(src, feature), `src/${feature}/ may hold only ${LAYERS.join(', ')}; found ${extra.join(', ')}`);
  }
  for (const dir of uiDirs.filter((name) => name !== SHARED && !features.includes(name))) {
    report('D6', path.join(ui, dir), `ui/${dir}/ has no src/${dir}/ (a feature's views sit next to its Rust module of the same name)`);
  }
  const owner = (rel, top) => rel.split('/')[0] === top && rel.split('/')[1];
  for (const { file, rel, code } of sources(crate, '.rs')) {
    const mine = owner(rel, 'src');
    if (!mine || rel.split('/').length < 3) continue; // lib.rs and ui_glue.rs at the root compose the features
    for (const { line, match } of matchesWithLines(code, /\bcrate::([a-z0-9_]+)/g)) {
      if (features.includes(match[1]) && match[1] !== mine) {
        report('D6', `${file}:${line}`, mine === SHARED ? `src/${SHARED} must not import the feature ${match[1]}` : `feature ${mine} imports feature ${match[1]}; move the shared code to src/${SHARED}/`);
      }
    }
  }
  for (const { file, rel, code } of sources(crate, '.slint')) {
    const mine = owner(rel, 'ui');
    if (!mine || rel.split('/').length < 3) continue;
    for (const { line, match } of matchesWithLines(code, SLINT_IMPORT)) {
      if (match[1].startsWith('@') || match[1] === 'std-widgets.slint') continue;
      const other = posix(path.relative(ui, path.resolve(path.dirname(file), match[1]))).split('/')[0];
      if (features.includes(other) && other !== mine) {
        report('D6', `${file}:${line}`, mine === SHARED ? `ui/${SHARED} must not import the feature ${other}` : `feature ${mine} imports a view of feature ${other}; move it to ui/${SHARED}/`);
      }
    }
  }
}

/** Returns the violations of the tree at `root` as `{ rule, where, message }`. */
export function check(root) {
  const violations = [];
  const report = (rule, where, message) => violations.push({ rule, where: posix(path.relative(root, where)), message });
  const crates = loadCrates(root);
  const names = crates.map((crate) => crate.name);
  for (const crate of crates) {
    if (FEATURE.test(crate.name)) {
      checkFeatureDependencies(crate, names, report);
      checkFeatureSlint(crate, report);
      checkLayout(crate, report);
    } else if (crate.name !== SHELL) {
      checkNotAFeatureUser(crate, report);
    }
  }
  return { violations, crates: crates.length, features: names.filter((name) => FEATURE.test(name)).length };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    const { selfTest } = await import('./boundaries-selftest.mjs');
    process.exit(selfTest(check) ? 0 : 1);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(args[0] ?? path.join(here, '..'));
  const label = posix(path.relative(path.resolve(here, '../../..'), root)) || '.';
  const { violations, crates, features } = check(root);
  for (const { rule, where, message } of violations) {
    console.log(`::error file=${label}/${where}::${rule} ${message}`);
  }
  if (violations.length > 0) {
    console.log(`FAIL: ${violations.length} desktop boundary violation(s).`);
    process.exit(1);
  }
  console.log(`OK: desktop crate boundaries hold (${crates} crates, ${features} features; rules D1-D6).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

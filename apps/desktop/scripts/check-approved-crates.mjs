// Dependency policy of the two Rust projects (apps/desktop workspace, apps/gateway), checked without cargo.
// cargo-deny cannot express "only approved DIRECT dependencies" (its `[bans] allow` list covers the whole
// tree, transitive crates included), so this script makes the Library-First claim true for direct ones.
//
//   A1  desktop: every external dependency of a member crate is `{ workspace = true }` and is declared in
//       `[workspace.dependencies]` (one version, one place)
//   A2  every declared dependency (desktop `[workspace.dependencies]`, gateway `[*dependencies]`) is listed
//       in `approved-crates.txt` next to that project's `deny.toml`
//   A3  every line of `approved-crates.txt` is named on the project's Library-First page (`name` in
//       backticks or bold) and is still declared in the manifest (no stale approvals)
//   A4  no declared dependency is banned in `deny.toml` (`[bans] deny`)
//   V1  a crate declared by both projects has the same version requirement in both
//   L1  the clippy / rustc lint levels of the two projects are equal, except EXPECTED_LINT_DIFFERENCES
//   T1  both `rust-toolchain.toml` files pin the same channel
//
// Usage: node check-approved-crates.mjs [--self-test] [REPO_ROOT]

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { directDependencies, readManifest, subdirectories } from './cargo-manifest.mjs';

const PROJECTS = {
  desktop: { dir: 'apps/desktop', page: 'docs/content/library-first/desktop.md' },
  gateway: { dir: 'apps/gateway', page: 'docs/content/library-first/gateway.md' },
};
// Lint levels that differ on purpose (desktop value, gateway value). Reasons: docs/content/desktop/boundaries.md.
export const EXPECTED_LINT_DIFFERENCES = {
  'rust.unsafe_code': ['deny', 'forbid'], // Slint-generated code carries #[allow(unsafe_code)]; forbid overrules it
  'clippy.panic': [undefined, 'deny'], // not applied on desktop until a compiler shows Slint-generated code passes
};

const posix = (file) => file.split(path.sep).join('/');
const levelOf = (value) => (typeof value === 'object' && value !== null ? value.level : value);

function readList(file) {
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
}

function namedOnPage(file) {
  if (!existsSync(file)) return new Set();
  const names = new Set();
  for (const match of readFileSync(file, 'utf8').matchAll(/`([A-Za-z0-9_-]+)`|\*\*([A-Za-z0-9_-]+)\*\*/g)) {
    names.add(match[1] ?? match[2]);
  }
  return names;
}

/** Declared external dependencies of a project as `Map<name, version requirement>`. */
function declared(root, id, report) {
  const dir = path.join(root, PROJECTS[id].dir);
  const manifestFile = path.join(dir, 'Cargo.toml');
  const manifest = readManifest(manifestFile);
  const versions = new Map();
  if (id === 'gateway') {
    for (const dep of directDependencies(manifest)) versions.set(dep.name, dep.spec.version);
    return versions;
  }
  for (const [name, raw] of Object.entries(manifest.workspace?.dependencies ?? {})) {
    versions.set(name, typeof raw === 'string' ? raw : raw.version);
  }
  const excluded = new Set((manifest.workspace?.exclude ?? []).map((entry) => path.basename(entry)));
  for (const crate of subdirectories(path.join(dir, 'crates')).filter((name) => !excluded.has(name))) {
    const crateManifest = path.join(dir, 'crates', crate, 'Cargo.toml');
    if (!existsSync(crateManifest)) continue;
    for (const dep of directDependencies(readManifest(crateManifest))) {
      if (dep.spec.path !== undefined) continue; // our own crates: check-feature-boundaries.mjs
      if (dep.spec.workspace !== true) {
        report('A1', crateManifest, `${dep.name} must be declared as { workspace = true } (versions live once in the workspace Cargo.toml)`);
      } else if (!versions.has(dep.name)) {
        report('A1', crateManifest, `${dep.name} is not in [workspace.dependencies]`);
      }
    }
  }
  return versions;
}

function checkProject(root, id, report) {
  const { dir, page } = PROJECTS[id];
  const versions = declared(root, id, report);
  const listFile = path.join(root, dir, 'approved-crates.txt');
  const manifestFile = path.join(root, dir, 'Cargo.toml');
  const approved = readList(listFile);
  if (approved === null) {
    report('A2', listFile, 'approved-crates.txt is missing');
    return versions;
  }
  const onPage = namedOnPage(path.join(root, page));
  const denyFile = path.join(root, dir, 'deny.toml');
  const banned = existsSync(denyFile) ? (readManifest(denyFile).bans?.deny ?? []).map((entry) => entry.crate ?? entry.name ?? entry) : [];
  for (const name of versions.keys()) {
    if (!approved.includes(name)) report('A2', manifestFile, `${name} is not in ${dir}/approved-crates.txt (add-dependency skill: the list and ${page} change together)`);
    if (banned.includes(name)) report('A4', manifestFile, `${name} is banned in ${dir}/deny.toml`);
  }
  for (const name of approved) {
    if (!onPage.has(name)) report('A3', listFile, `${name} is approved but not named on ${page}`);
    if (!versions.has(name)) report('A3', listFile, `${name} is approved but no longer declared in ${dir}/Cargo.toml (remove the stale line)`);
  }
  return versions;
}

function lintLevels(manifest) {
  const lints = manifest.workspace?.lints ?? manifest.lints ?? {};
  const levels = {};
  for (const tool of ['rust', 'clippy']) {
    for (const [name, value] of Object.entries(lints[tool] ?? {})) levels[`${tool}.${name}`] = levelOf(value);
  }
  return levels;
}

function checkShared(root, versions, report) {
  const [desktopDir, gatewayDir] = [path.join(root, PROJECTS.desktop.dir), path.join(root, PROJECTS.gateway.dir)];
  const gatewayManifest = path.join(gatewayDir, 'Cargo.toml');
  for (const [name, version] of versions.gateway) {
    const other = versions.desktop.get(name);
    if (other !== undefined && other !== version) {
      report('V1', gatewayManifest, `${name} is "${version}" here and "${other}" in apps/desktop/Cargo.toml; use one requirement in both`);
    }
  }
  const desktop = lintLevels(readManifest(path.join(desktopDir, 'Cargo.toml')));
  const gateway = lintLevels(readManifest(gatewayManifest));
  for (const lint of new Set([...Object.keys(desktop), ...Object.keys(gateway)])) {
    const expected = EXPECTED_LINT_DIFFERENCES[lint];
    const same = desktop[lint] === gateway[lint];
    const asExpected = expected && expected[0] === desktop[lint] && expected[1] === gateway[lint];
    if (!same && !asExpected) {
      report('L1', gatewayManifest, `lint ${lint} is ${desktop[lint] ?? 'unset'} on desktop and ${gateway[lint] ?? 'unset'} on the gateway`);
    }
  }
  const channel = (dir) => {
    const file = path.join(dir, 'rust-toolchain.toml');
    return existsSync(file) ? readManifest(file).toolchain?.channel : undefined;
  };
  if (channel(desktopDir) !== channel(gatewayDir)) {
    report('T1', path.join(gatewayDir, 'rust-toolchain.toml'), `toolchain channel ${channel(gatewayDir)} differs from desktop ${channel(desktopDir)}`);
  }
}

/** Returns the violations for the repository at `root` as `{ rule, where, message }`. */
export function check(root) {
  const violations = [];
  const report = (rule, where, message) => violations.push({ rule, where: posix(path.relative(root, where)), message });
  const versions = {};
  for (const id of Object.keys(PROJECTS)) {
    // A template profile may remove a whole app (task template:new); the other one is still checked.
    if (existsSync(path.join(root, PROJECTS[id].dir, 'Cargo.toml'))) versions[id] = checkProject(root, id, report);
  }
  if (versions.desktop && versions.gateway) checkShared(root, versions, report);
  return { violations, checked: Object.entries(versions).map(([id, map]) => `${id} ${map.size}`) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    const { selfTest } = await import('./approved-crates-selftest.mjs');
    process.exit(selfTest(check) ? 0 : 1);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { violations, checked } = check(path.resolve(args[0] ?? path.join(here, '../../..')));
  for (const { rule, where, message } of violations) console.log(`::error file=${where}::${rule} ${message}`);
  if (violations.length > 0) {
    console.log(`FAIL: ${violations.length} Rust dependency policy violation(s).`);
    process.exit(1);
  }
  console.log(`OK: direct Rust dependencies are approved and shared versions agree (${checked.join(', ')} crates; rules A1-A4, V1, L1, T1).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

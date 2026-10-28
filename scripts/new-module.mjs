#!/usr/bin/env node
// `task new:module -- NAME=<id>`: stamps a minimal, gate-passing feature module on every platform
// (server, web, android, apple, desktop) from scripts/templates/<platform>/** and registers it in the
// shared registries (scripts/new-module-registries.mjs). Docs: docs/agent/new-module.md.
//
// Usage: node scripts/new-module.mjs NAME=<id> [--platforms=server,web,android,apple,desktop]
//                                   [--dry-run] [--no-codegen] [--remove [--force]]
//   NAME       one lowercase word, letters and digits, starting with a letter (like every existing module)
//   --remove   undo a stamp (files + registry lines + generated server code); refuses modules whose
//              files are tracked by git unless --force (protects tasks, auth, ...)
//
// Templates are plain text with {{name}} / {{Name}} / {{NAME}} substitution; `.tmpl` is stripped from the
// file name and `__name__` / `__Name__` in path segments are substituted too.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registryEdits } from './new-module-registries.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PLATFORMS = ['server', 'web', 'android', 'apple', 'desktop'];

const RESERVED = new Set([
  'platform', 'shared', 'core', 'common', 'app', 'api', 'internal', 'test', 'tests', 'build', 'main', 'gen',
  'module', 'modules', 'config', 'public', 'private', 'default', 'template', 'new', 'go', 'func', 'type', 'var',
  'package', 'import', 'class', 'object', 'interface', 'fun', 'val', 'domain', 'application', 'infrastructure',
  'transport', 'jobs', 'ui', 'lib', 'i18n', 'v1', 'sample_', 'aedst', 'buf', 'google', 'connect', 'proto',
]);

export function forms(name) {
  return { name, Name: name[0].toUpperCase() + name.slice(1), NAME: name.toUpperCase() };
}

export function validateName(name, root) {
  if (!name) return 'NAME is required (task new:module -- NAME=<id>)';
  if (!/^[a-z][a-z0-9]{1,23}$/.test(name)) {
    return `NAME "${name}" must be one lowercase word of 2-24 letters/digits starting with a letter (like tasks, search)`;
  }
  if (RESERVED.has(name)) return `NAME "${name}" is a reserved word`;
  const roots = ['apps/server/internal/modules', 'apps/web/app/src/modules', 'apps/android/feature', 'apps/apple/Features', 'apps/desktop/Modules/Features'];
  for (const r of roots) {
    const dir = path.join(root, r);
    if (!existsSync(dir)) continue;
    if (readdirSync(dir).some((e) => e.toLowerCase() === name)) return `module "${name}" already exists under ${r}`;
  }
  return null;
}

const subst = (s, c) => s.replace(/__name__/g, c.name).replace(/__Name__/g, c.Name).replace(/\{\{(name|Name|NAME)\}\}/g, (_, k) => c[k]);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

/** Files a stamp produces: [{ platform, dest (repo-relative, posix), content }]. */
export function renderTemplates(c, platforms, templatesDir = path.join(HERE, 'templates')) {
  const out = [];
  for (const platform of platforms) {
    const base = path.join(templatesDir, platform);
    if (!existsSync(base)) throw new Error(`no templates for platform ${platform}`);
    for (const file of walk(base)) {
      const rel = path.relative(base, file).split(path.sep).join('/');
      if (!rel.endsWith('.tmpl')) continue;
      out.push({ platform, dest: subst(rel.slice(0, -'.tmpl'.length), c), content: subst(readFileSync(file, 'utf8'), c) });
    }
  }
  return out;
}

/** Applies every registry edit in memory: Map<file, newText>. Throws on a missing file or anchor. */
export function planRegistry(c, platforms, root, mode) {
  const selected = new Set(platforms);
  const all = PLATFORMS.every((p) => selected.has(p));
  const texts = new Map();
  for (const edit of registryEdits(c)) {
    if (edit.platform === 'all' ? !all : !selected.has(edit.platform)) continue;
    const abs = path.join(root, edit.file);
    if (!texts.has(edit.file)) {
      if (!existsSync(abs)) throw new Error(`registry file missing: ${edit.file}`);
      texts.set(edit.file, readFileSync(abs, 'utf8'));
    }
    try {
      texts.set(edit.file, edit[mode](texts.get(edit.file)));
    } catch (err) {
      throw new Error(`${edit.file}: ${err.message}`);
    }
  }
  const changed = new Map();
  for (const [file, text] of texts) if (text !== readFileSync(path.join(root, file), 'utf8')) changed.set(file, text);
  return changed;
}

function run(root, cwd, cmd, args) {
  try {
    execFileSync(cmd, args, { cwd: path.join(root, cwd), stdio: 'inherit' });
    return true;
  } catch (err) {
    console.warn(`WARNING: \`${cmd} ${args.join(' ')}\` (in ${cwd}) failed or is not installed (${err.code ?? err.status}). Run it manually.`);
    return false;
  }
}

function pruneEmpty(dir, stop) {
  let d = dir;
  while (d !== stop && existsSync(d) && readdirSync(d).length === 0) {
    rmdirSync(d);
    d = path.dirname(d);
  }
}

export function scaffold({ name, platforms = PLATFORMS, root, dryRun = false, remove = false, force = false, codegen = true, log = console.log }) {
  const c = forms(name);
  if (!remove) {
    const problem = validateName(name, root);
    if (problem) throw new Error(problem);
  } else if (!/^[a-z][a-z0-9]{1,23}$/.test(name ?? '')) {
    throw new Error('NAME is required');
  }
  const files = renderTemplates(c, platforms);
  const generated = [
    ...(platforms.includes('server') ? [`apps/server/gen/db/${name}`, `apps/server/gen/go/aedst/${name}`] : []),
    ...(platforms.includes('android') ? [`apps/android/feature/${name}/build`] : []),
  ];

  if (remove) {
    const present = files.filter((f) => existsSync(path.join(root, f.dest)));
    if (!force && present.length) {
      const tracked = execFileSync('git', ['ls-files', '--', ...present.map((f) => f.dest)], { cwd: root, encoding: 'utf8' }).trim();
      if (tracked) throw new Error(`refusing to remove "${name}": git tracks its files (${tracked.split('\n')[0]} ...). Use --force only for a stamp you committed yourself.`);
    }
    const edits = planRegistry(c, platforms, root, 'remove');
    log(`${dryRun ? 'would remove' : 'removing'} ${present.length} files, ${generated.length} generated dirs, ${edits.size} registry edits`);
    if (dryRun) return { files: present.map((f) => f.dest), registry: [...edits.keys()] };
    for (const f of present) {
      rmSync(path.join(root, f.dest));
      pruneEmpty(path.dirname(path.join(root, f.dest)), root);
    }
    for (const g of generated) {
      rmSync(path.join(root, g), { recursive: true, force: true });
      pruneEmpty(path.dirname(path.join(root, g)), root);
    }
    for (const [file, text] of edits) writeFileSync(path.join(root, file), text);
    return { files: present.map((f) => f.dest), registry: [...edits.keys()] };
  }

  const clashes = files.filter((f) => existsSync(path.join(root, f.dest)));
  if (clashes.length) throw new Error(`refusing to overwrite existing files:\n  ${clashes.map((f) => f.dest).join('\n  ')}`);
  const edits = planRegistry(c, platforms, root, 'add');
  log(`${dryRun ? 'would create' : 'creating'} ${files.length} files and edit ${edits.size} registries for module "${name}" (${platforms.join(', ')})`);
  for (const f of files) log(`  + ${f.dest}`);
  for (const file of edits.keys()) log(`  ~ ${file}`);
  if (platforms.length < PLATFORMS.length) log('  note: features.yaml was NOT edited (partial platform set); `task check:features` stays red until every platform exists or you declare it by hand.');
  if (dryRun) return { files: files.map((f) => f.dest), registry: [...edits.keys()] };

  for (const f of files) {
    const abs = path.join(root, f.dest);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
  }
  for (const [file, text] of edits) writeFileSync(path.join(root, file), text);

  if (codegen && platforms.includes('server')) {
    run(root, 'apps/server', 'buf', ['generate', '--path', `api/proto/aedst/${name}`]);
    run(root, 'apps/server', 'sqlc', ['generate']);
    run(root, 'apps/server', 'gofumpt', ['-l', '-w', `gen/db/${name}`, `gen/go/aedst/${name}`]);
  }
  log('done. Next: task check, and see docs/agent/new-module.md for what each platform template does and does not cover.');
  return { files: files.map((f) => f.dest), registry: [...edits.keys()] };
}

function main(argv) {
  let name = null;
  let platforms = PLATFORMS;
  const flags = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('NAME=')) name = a.slice(5);
    else if (a === '--name') name = argv[++i];
    else if (a.startsWith('--name=')) name = a.slice(7);
    else if (a.startsWith('--platforms=')) platforms = a.slice(12).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--')) flags.add(a);
    else throw new Error(`unknown argument: ${a}`);
  }
  const bad = platforms.filter((p) => !PLATFORMS.includes(p));
  if (bad.length) throw new Error(`unknown platform(s): ${bad.join(', ')} (known: ${PLATFORMS.join(', ')})`);
  const root = path.resolve(HERE, '..');
  scaffold({ name, platforms, root, dryRun: flags.has('--dry-run'), remove: flags.has('--remove'), force: flags.has('--force'), codegen: !flags.has('--no-codegen') });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`new-module: ${err.message}`);
    process.exit(1);
  }
}

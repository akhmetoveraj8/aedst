#!/usr/bin/env node
// Turn this repository into a product-specific starting point (`task template:new -- ...`).
//
//   node scripts/template-new.mjs --name <brand> --profile core|mobile|full (--out <dir> | --in-place) [options]
//
// 1. Profile: delete the platforms the profile does not include (apps/<platform>, workflows, docs,
//    Taskfile tasks, renovate, lefthook, CODEOWNERS, INDEX rows, features.yaml, file-size.config,
//    i18n allowlist, ...). What is removed is described by scripts/template-profiles.json.
// 2. Rename only EXTERNAL identifiers (display name, bundle/application id, chart/image names,
//    domains, cookie name, Velopack pack id). The internal codename stays; see
//    docs/content/decisions/cross-cutting.md.
//
// Safety: nothing is touched unless you pass `--out <dir>` (writes a new directory) or `--in-place`
// (destructive, refuses a dirty git tree unless `--allow-dirty`). `--dry-run` runs the whole
// pipeline on a throwaway copy and prints the plan.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { dropBlocks, dropLines, dropMarkdownSections, dropUnusedExt, featuresYaml, renovateJson, unlinkRemoved } from './template-lib/edits.mjs';
import { copyTree, globToRegExp, listSourceFiles, matchesAny, pruneEmptyDirs, readText, removePath, writeText } from './template-lib/fs-utils.mjs';
import { deriveNames, renameExternal } from './template-lib/rename.mjs';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `Usage: template-new --name <brand> --profile core|mobile|full (--out <dir> | --in-place) [--dry-run]
         [--org <github-org>] [--domain <label>] [--keep-tool] [--allow-dirty] [--verbose]`;

function parseArgs(argv) {
  const a = { flags: new Set() };
  const valued = new Set(['name', 'profile', 'out', 'org', 'domain']);
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--') continue;
    if (!t.startsWith('--')) throw new Error(`unexpected argument: ${t}\n${USAGE}`);
    const k = t.slice(2);
    if (valued.has(k)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`--${k} needs a value\n${USAGE}`);
      a[k] = v;
    } else if (['dry-run', 'in-place', 'keep-tool', 'allow-dirty', 'verbose', 'help'].includes(k)) a.flags.add(k);
    else throw new Error(`unknown option: ${t}\n${USAGE}`);
  }
  return a;
}

const sub = (obj, p, P) => JSON.parse(JSON.stringify(obj).replaceAll('${p}', p).replaceAll('${P}', P));

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('help')) { console.log(USAGE); return 0; }
  const cfg = JSON.parse(fs.readFileSync(path.join(SOURCE_ROOT, 'scripts', 'template-profiles.json'), 'utf8'));
  const profile = cfg.profiles[args.profile];
  if (!profile) throw new Error(`--profile must be one of ${Object.keys(cfg.profiles).join(', ')}\n${USAGE}`);
  if (!args.name) throw new Error(`--name is required\n${USAGE}`);
  const names = deriveNames({ name: args.name, org: args.org, domain: args.domain });
  const dry = args.flags.has('dry-run');
  const inPlace = args.flags.has('in-place');
  if (inPlace && args.out) throw new Error('--in-place and --out are mutually exclusive');
  if (!inPlace && !args.out && !dry) throw new Error(`choose --out <dir> (new copy), --in-place (destructive) or --dry-run\n${USAGE}`);

  let work;
  let tmp = null;
  if (inPlace && !dry) {
    if (!args.flags.has('allow-dirty') && gitDirty(SOURCE_ROOT)) throw new Error('git working tree is not clean; commit/stash first or pass --allow-dirty');
    work = SOURCE_ROOT;
  } else {
    work = dry ? (tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'template-new-'))) : path.resolve(args.out);
    if (!dry && fs.existsSync(work) && fs.readdirSync(work).length > 0) throw new Error(`--out ${work} exists and is not empty`);
    fs.mkdirSync(work, { recursive: true });
    if (path.relative(SOURCE_ROOT, work) === '' ) throw new Error('--out must not be the repository itself');
    copyTree(SOURCE_ROOT, work, listSourceFiles(SOURCE_ROOT));
  }

  try {
    const report = apply(work, cfg, profile, names, args.flags.has('keep-tool'), args.flags.has('verbose'));
    print(report, args, profile, names, dry, inPlace ? work : work);
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
  return 0;
}

function gitDirty(root) {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '';
  } catch {
    return false;
  }
}

const withParents = (files) => {
  const s = new Set(files);
  for (const f of files) for (let d = path.posix.dirname(f); d !== '.' && !s.has(d); d = path.posix.dirname(d)) s.add(d);
  return s;
};

function apply(root, cfg, profile, names, keepTool, verbose) {
  const log = { deleted: [], edits: [], warnings: [], unlinked: 0 };
  let files = listSourceFiles(root);
  const before = withParents(files);
  const removed = profile.remove;

  // 1. delete platform trees
  const doomed = new Set();
  const doomedWorkflows = [];
  for (const p of removed) {
    for (const g of cfg.platforms[p].delete) {
      const re = globToRegExp(g);
      let hit = false;
      for (const f of files) {
        const parts = f.split('/');
        for (let i = 1; i <= parts.length; i++) {
          if (re.test(parts.slice(0, i).join('/'))) { doomed.add(f); hit = true; if (f.startsWith('.github/workflows/')) doomedWorkflows.push(path.posix.basename(f)); break; }
        }
      }
      if (!hit && g === cfg.platforms[p].delete[0]) log.warnings.push(`${p}: ${g} does not exist (already removed?)`);
    }
  }
  for (const f of doomed) removePath(root, f);
  pruneEmptyDirs(root);
  files = files.filter((f) => !doomed.has(f));
  log.deleted = [...doomed];

  // 2. edit shared files
  const ops = [];
  for (const p of removed) {
    const P = cfg.platforms[p].label;
    for (const op of cfg.perPlatform) ops.push(sub(op, p, P));
    for (const op of cfg.platforms[p].ops) ops.push(sub(op, p, P));
  }
  if (removed.length) ops.push(...cfg.ifAnyRemoved);
  const mdRe = cfg.markdownGlobs.map(globToRegExp);
  const skipEdit = [/^docs\/archive\//, /^CHANGELOG\.md$/];
  const resolve = (op) => {
    if (op.file) return files.includes(op.file) ? [op.file] : [];
    return files.filter((f) => (op.globs.includes('@markdown') ? matchesAny(f, mdRe) : matchesAny(f, op.globs.map(globToRegExp))) && !matchesAny(f, skipEdit));
  };
  const runOp = (op, f, text) => {
    if (op.op === 'dropLines') return dropLines(text, op.pattern);
    if (op.op === 'dropBlocks') return dropBlocks(text, op);
    if (op.op === 'dropMarkdownSections') return dropMarkdownSections(text, op.heading);
    if (op.op === 'appendLines') return { text: `${text.replace(/\n*$/, '\n')}${op.lines.join('\n')}\n`, n: op.lines.length };
    throw new Error(`unknown op ${op.op}`);
  };
  const touch = (f, label, fn) => {
    const text = readText(root, f);
    if (text === null) return;
    const r = fn(text);
    if (r.n > 0) { writeText(root, f, r.text); log.edits.push(`${f}: ${label} (${r.n})`); }
  };
  for (const op of ops) {
    const targets = resolve(op);
    if (op.file && targets.length === 0) { log.warnings.push(`missing file for ${op.op}: ${op.file}`); continue; }
    for (const f of targets) touch(f, `${op.op} ${op.key ?? op.pattern ?? op.heading}`, (t) => runOp(op, f, t));
  }
  for (const p of removed) {
    const spec = cfg.platforms[p];
    if (files.includes('features.yaml')) touch('features.yaml', `features ${p}`, (t) => featuresYaml(t, p));
    if (files.includes('renovate.json')) {
      const r = { ...spec.renovate, basenames: doomedWorkflows };
      touch('renovate.json', `renovate ${p}`, (t) => renovateJson(t, r));
    }
  }
  if (files.includes('scripts/file-size.config') && removed.length) {
    const exts = removed.flatMap((p) => cfg.platforms[p].extUnused);
    touch('scripts/file-size.config', 'unused ext', (t) => dropUnusedExt(t, exts, files));
  }

  // 3. markdown links to deleted docs become plain text
  const after = withParents(files);
  for (const f of files.filter((x) => /\.mdx?$/.test(x) && !x.startsWith('docs/archive/'))) {
    touch(f, 'unlink', (t) => { const r = unlinkRemoved(t, f, before, after); log.unlinked += r.n; return r; });
  }

  // 4. rename external identifiers
  const ren = renameExternal(root, files, names);
  files = ren.files;
  log.renamed = { edited: ren.edited, moved: ren.moved };

  // 5. remove the scaffolding itself
  if (!keepTool) {
    for (const f of cfg.finalize.deleteTool) removePath(root, f);
    for (const op of cfg.finalize.taskfileBlocks) if (files.includes(op.file)) touch(op.file, `finalize ${op.key}`, (t) => dropBlocks(t, op));
    const [b, e] = cfg.finalize.markers;
    for (const f of cfg.finalize.markerFiles) {
      if (!files.includes(f)) continue;
      touch(f, 'template section', (t) => {
        const re = new RegExp(`\\n?${b}[\\s\\S]*?${e}\\n?`, 'g');
        const out = t.replace(re, '\n');
        return { text: out, n: out === t ? 0 : 1 };
      });
    }
    pruneEmptyDirs(root);
  }
  log.verbose = verbose;
  return log;
}

function print(r, args, profile, names, dry, where) {
  const lines = [
    `profile ${args.profile}: ${profile.description}`,
    `removed platforms: ${profile.remove.join(', ') || '(none)'}`,
    `deleted ${r.deleted.length} files; edited ${r.edits.length} shared-file ops; unlinked ${r.unlinked} doc links`,
    `renamed external identifiers: ${r.renamed.edited} files edited, ${r.renamed.moved} paths moved`,
    `names: display="${names.display}" slug=${names.slug} id=${names.id} cookie=${names.snake}_session org=${names.org} domain=${names.domainBase}.{com,dev,app,example}`,
    'kept (internal codename): proto packages aedst.*, Go import path, Aedst* types, QML URI, AEDST_ env prefix',
  ];
  if (r.verbose) lines.push(...r.edits.map((e) => `  ${e}`));
  if (r.warnings.length) lines.push('warnings:', ...r.warnings.map((w) => `  ${w}`));
  console.log(lines.join('\n'));
  if (dry) console.log('dry run: nothing was written.');
  else console.log(`done: ${where}\nnext: git branch -m master main (if needed); task setup; task doctor; task check`);
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(`template-new: ${e.message}`);
  process.exitCode = 2;
}

#!/usr/bin/env node
// `task new:feature -- MODULE=<m> NAME=<f>`: stamps one feature inside an existing module
// (docs/content/architecture/modules-and-features.md). This file is the shared CLI and the server
// part; each other platform plugs in below (see PLATFORM HOOKS). Docs: docs/agent/new-module.md.
//
// Usage: node scripts/new-feature.mjs MODULE=<module> NAME=<feature> [--platforms=server,web]
//                                     [--project=app|admin] [--dry-run] [--remove]
//   MODULE       an existing module id (tasks)
//   NAME         the feature id: lowercase words, optionally joined by "-" (archive, bulk-edit).
//                The server folder is a Go package path element, so it drops the hyphens (bulkedit).
//   --platforms  default: server. A platform is stamped only when it is listed.
//   --project    passed to the web part (which web project owns the module)
//
// Server: creates apps/server/internal/modules/<m>/features/<f>/application/{service,service_test}.go
// from scripts/templates/server/feature/**/*.ftmpl (relative to the module folder; `.ftmpl` so
// `task new:module`, which stamps every `.tmpl` under scripts/templates/server, skips them).
// Placeholders: {{module}}, {{feature}}. It edits nothing: the feature is wired by hand in
// modules/<m>/module, and architecturetest fails until it is (TestEveryFeatureIsComposedByItsModule).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_TEMPLATES = path.join(HERE, 'templates', 'server', 'feature');
// The layers a server feature may contain (architecturetest/features_test.go) and other names with
// a meaning inside a module: none of them can be a feature.
const SERVER_RESERVED = new Set([
  'application', 'domain', 'infrastructure', 'transport', 'api', 'module', 'features', 'jobs', 'shared', 'internal',
  'test', 'tests', 'main', 'go', 'func', 'type', 'var', 'package', 'import', 'interface',
]);

/** bulk-edit -> bulkedit: the feature id as a Go package path element. */
export const serverFeatureName = (name) => name.replaceAll('-', '');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const subst = (text, c) => text.replace(/__feature__/g, c.feature).replace(/\{\{(module|feature)\}\}/g, (_, key) => c[key]);

export function scaffoldServerFeature({ module, name, root, dryRun = false, remove = false, log = console.log }) {
  if (!/^[a-z][a-z0-9]{1,23}$/.test(module ?? '')) throw new Error('MODULE is required: an existing module id (task new:feature -- MODULE=<m> NAME=<f>)');
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name ?? '')) throw new Error(`NAME "${name ?? ''}" must be a lowercase feature id (archive, bulk-edit)`);
  const feature = serverFeatureName(name);
  if (feature.length < 2 || feature.length > 24) throw new Error(`NAME "${name}" must give a server package name of 2-24 characters (got "${feature}")`);
  if (SERVER_RESERVED.has(feature)) throw new Error(`NAME "${name}" is a reserved name on the server`);

  const moduleRel = `apps/server/internal/modules/${module}`;
  const moduleDir = path.join(root, moduleRel);
  if (!existsSync(path.join(moduleDir, 'module'))) throw new Error(`module "${module}" does not exist on the server (${moduleRel}/module)`);
  const featureRel = `${moduleRel}/features/${feature}`;

  const c = { module, feature };
  const files = walk(SERVER_TEMPLATES)
    .filter((file) => file.endsWith('.ftmpl'))
    .map((file) => {
      const rel = path.relative(SERVER_TEMPLATES, file).split(path.sep).join('/').slice(0, -'.ftmpl'.length);
      return { dest: `${moduleRel}/${subst(rel, c)}`, content: subst(readFileSync(file, 'utf8'), c) };
    });

  if (remove) {
    // Only an untouched stamp is removed: anything else in the folder is someone's work.
    const extra = existsSync(path.join(root, featureRel))
      ? walk(path.join(root, featureRel)).map((abs) => path.relative(root, abs).split(path.sep).join('/')).filter((rel) => !files.some((f) => f.dest === rel))
      : [];
    if (extra.length) throw new Error(`refusing to remove ${featureRel}: it holds files the generator did not create (${extra[0]} ...)`);
  } else {
    if (existsSync(path.join(root, featureRel))) throw new Error(`feature already exists: ${featureRel}`);
  }

  log(`${dryRun ? 'would ' : ''}${remove ? 'remove' : 'create'} feature "${module}/${feature}" in apps/server`);
  for (const f of files) log(`  ${remove ? '-' : '+'} ${f.dest}`);
  const result = { files: files.map((f) => f.dest), edited: [] };
  if (dryRun) return result;

  for (const f of files) {
    const abs = path.join(root, f.dest);
    if (remove) {
      rmSync(abs, { force: true });
      for (let dir = path.dirname(abs); dir !== moduleDir && existsSync(dir) && readdirSync(dir).length === 0; dir = path.dirname(dir)) rmdirSync(dir);
    } else {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
    }
  }

  if (!remove) {
    const others = readdirSync(path.join(moduleDir, 'features')).filter((entry) => entry !== feature);
    if (others.length === 0 && existsSync(path.join(moduleDir, 'application'))) {
      log(`  note: this is the module's first features/ folder. Move the capability that lives in ${moduleRel}/{application,infrastructure,transport} into a feature in the same change (rule 5 of modules-and-features.md); architecturetest rejects a module-level application/ beside features/.`);
    }
    log(`  next: wire it in ${moduleRel}/module (build application.NewService in Setup; architecturetest fails until that package imports the feature), put shared types in ${moduleRel}/domain and contracts in ${moduleRel}/api, add infrastructure/postgres or transport when the feature needs them, then run the server gates (go test ./architecturetest/... ./internal/modules/${module}/...).`);
  }
  return result;
}

// ---- PLATFORM HOOKS ---------------------------------------------------------------------------
// One entry per platform that can stamp a feature. Each takes the parsed options
// ({ module, name, project, root, dryRun, remove, log }) and returns { files, edited }.
// WEB HOOK: the web part lives in scripts/new-feature-web.mjs (owned with scripts/templates/web/**);
// it is loaded only when `web` is selected, so the server part has no dependency on it.
// Android, Apple and Desktop are frozen (docs/content/status.md): add their hooks after their first green CI run.
const PLATFORM_HOOKS = {
  server: async (options) => scaffoldServerFeature(options),
  web: async (options) => {
    const { scaffoldWebFeature } = await import('./new-feature-web.mjs');
    const { project, ...rest } = options;
    return scaffoldWebFeature(project ? { ...rest, project } : rest);
  },
};
export const FEATURE_PLATFORMS = Object.keys(PLATFORM_HOOKS);

export async function scaffoldFeature({ platforms = ['server'], ...options }) {
  const bad = platforms.filter((p) => !(p in PLATFORM_HOOKS));
  if (bad.length) throw new Error(`unknown platform(s): ${bad.join(', ')} (features can be stamped on: ${FEATURE_PLATFORMS.join(', ')})`);
  const result = {};
  for (const platform of platforms) result[platform] = await PLATFORM_HOOKS[platform](options);
  return result;
}

export function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg.startsWith('MODULE=')) options.module = arg.slice(7);
    else if (arg.startsWith('NAME=')) options.name = arg.slice(5);
    else if (arg.startsWith('--platforms=')) options.platforms = arg.slice(12).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--project=')) options.project = arg.slice(10);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--remove') options.remove = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await scaffoldFeature({ root: path.resolve(HERE, '..'), ...parseArgs(process.argv.slice(2)) });
  } catch (err) {
    console.error(`new-feature: ${err.message}`);
    process.exit(1);
  }
}

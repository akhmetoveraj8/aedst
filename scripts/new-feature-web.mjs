#!/usr/bin/env node
// Web part of `task new:feature -- MODULE=<m> NAME=<f>`: stamps one feature
// (docs/content/architecture/modules-and-features.md) inside an existing web
// module and wires it into the module's contract.
//
// Usage: node scripts/new-feature-web.mjs MODULE=<module> NAME=<feature>
//                                         [--project=app|admin] [--dry-run] [--remove]
//   MODULE   an existing module of the project (src/modules/<module>/manifest.ts)
//   NAME     kebab-case feature id (bulk-edit, archive); becomes the folder name
//
// Creates  src/modules/<m>/features/<f>/ui/<f>-view.tsx and its test
// Edits    public.ts (one export line, in Biome's sort order) and packages/i18n/<module>/{en,ru,tg,uz,ar}.json and its Web copy under apps/web/shared/i18n/catalogs (key <featureKey>.title,
//          the English text in every locale: translate it before merging)
//
// Templates: scripts/templates/web/feature/**/*.ftmpl, relative to the module folder. They end in
// `.ftmpl` so `task new:module` (which stamps every `.tmpl` under scripts/templates/web) skips them.
// Placeholders: {{module}}, {{feature}}, {{Feature}}, {{featureKey}}, {{intlPackage}}, {{clientDirective}}.
//
// `scaffoldWebFeature` is exported so the shared CLI (scripts/new-module.mjs) can call it for the
// web platform with the same MODULE / NAME flags. Marketing is not supported: its sections are Server
// Components without a component-test harness; add them by hand (apps/web/marketing/AGENTS.md).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, 'templates', 'web', 'feature');
// Shared translation files name Tajik `tg` (packages/i18n); the Web copy under apps/web/shared keeps the same names.
const LOCALES = ['en', 'ru', 'tg', 'uz', 'ar'];
const PROJECTS = {
  app: { intlPackage: 'next-intl', clientDirective: '"use client";\n\n' },
  admin: { intlPackage: 'use-intl', clientDirective: '' },
};
// Folder names with a meaning inside a module or a feature.
const RESERVED = new Set(['ui', 'lib', 'i18n', 'entries', 'features', 'shared', 'public', 'manifest', 'outbox', 'test', 'tests']);

export function featureForms(module, feature) {
  const words = feature.split('-');
  const Feature = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return { module, feature, Feature, featureKey: Feature[0].toLowerCase() + Feature.slice(1) };
}

const subst = (text, c) =>
  text.replace(/__feature__/g, c.feature).replace(/\{\{(\w+)\}\}/g, (whole, key) => (key in c ? c[key] : whole));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

// Text edits keep the file's line endings (CRLF checkouts on Windows).
const read = (abs) => readFileSync(abs, 'utf8');
const eol = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

function publicEdit(c) {
  const line = `export { ${c.Feature}View } from "@/modules/${c.module}/features/${c.feature}/ui/${c.feature}-view";`;
  return {
    // Biome sorts re-exports by source path: insert before the first single-line export that sorts later.
    add(text) {
      if (text.includes(line)) return text;
      const nl = eol(text);
      const lines = text.trimEnd().split(/\r?\n/);
      const source = (l) => /^export \{[^}]*\} from "([^"]+)";$/.exec(l)?.[1];
      const mine = source(line);
      const at = lines.findIndex((l) => (source(l) ?? '') > mine);
      lines.splice(at === -1 ? lines.length : at, 0, line);
      return `${lines.join(nl)}${nl}`;
    },
    remove: (text) => text.replace(new RegExp(`\\r?\\n${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\r?\\n|$)`), ''),
  };
}

function catalogEdit(c) {
  const title = c.feature.split('-').join(' ');
  const block = (nl) => `,${nl}  "${c.featureKey}": {${nl}    "title": "${title[0].toUpperCase()}${title.slice(1)}"${nl}  }`;
  return {
    add(text) {
      if (c.featureKey in JSON.parse(text)) throw new Error(`i18n key "${c.featureKey}" already exists`);
      const nl = eol(text);
      const body = text.trimEnd();
      if (!body.endsWith('}')) throw new Error('catalogue is not a JSON object');
      return `${body.slice(0, -1).trimEnd()}${block(nl)}${nl}}${nl}`;
    },
    remove: (text) => text.replace(block(eol(text)), ''),
  };
}

/** Plans (and unless dryRun, applies) one feature stamp. Returns { files, edited } as repo-relative posix paths. */
export function scaffoldWebFeature({ module, name, project = 'app', root, dryRun = false, remove = false, log = console.log }) {
  if (!(project in PROJECTS)) throw new Error(`unknown web project "${project}" (supported: ${Object.keys(PROJECTS).join(', ')})`);
  if (!/^[a-z][a-z0-9]{1,23}$/.test(module ?? '')) throw new Error('MODULE is required: an existing module id (task new:feature -- MODULE=<m> NAME=<f>)');
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name ?? '') || name.length > 40) {
    throw new Error(`NAME "${name ?? ''}" must be a kebab-case feature id (archive, bulk-edit)`);
  }
  if (RESERVED.has(name)) throw new Error(`NAME "${name}" is a reserved folder name`);

  const moduleRel = `apps/web/${project}/src/modules/${module}`;
  const moduleDir = path.join(root, moduleRel);
  if (!existsSync(path.join(moduleDir, 'manifest.ts'))) throw new Error(`module "${module}" does not exist in ${project} (${moduleRel}/manifest.ts)`);

  const c = { ...featureForms(module, name), ...PROJECTS[project] };
  const files = walk(TEMPLATES)
    .filter((file) => file.endsWith('.ftmpl'))
    .map((file) => {
      const rel = path.relative(TEMPLATES, file).split(path.sep).join('/').slice(0, -'.ftmpl'.length);
      return { dest: `${moduleRel}/${subst(rel, c)}`, content: subst(read(file), c) };
    });
  const edits = [
    { file: `${moduleRel}/public.ts`, ...publicEdit(c) },
    ...LOCALES.flatMap((locale) =>
      [`packages/i18n/${module}/${locale}.json`, `apps/web/shared/i18n/catalogs/${module}/${locale}.json`].map((file) => ({ file, ...catalogEdit(c) })),
    ),
  ];
  for (const edit of edits) {
    if (!existsSync(path.join(root, edit.file))) throw new Error(`missing ${edit.file}`);
  }

  const mode = remove ? 'remove' : 'add';
  if (!remove) {
    const featureDir = `${moduleRel}/features/${name}`;
    if (existsSync(path.join(root, featureDir))) throw new Error(`feature already exists: ${featureDir}`);
    const clashes = files.filter((f) => existsSync(path.join(root, f.dest)));
    if (clashes.length) throw new Error(`refusing to overwrite existing files:\n  ${clashes.map((f) => f.dest).join('\n  ')}`);
  }
  const planned = edits.map((edit) => {
    const before = read(path.join(root, edit.file));
    let after;
    try {
      after = edit[mode](before);
    } catch (err) {
      throw new Error(`${edit.file}: ${err.message}`);
    }
    return { file: edit.file, before, after };
  });
  const changed = planned.filter((p) => p.after !== p.before);

  log(`${dryRun ? 'would ' : ''}${remove ? 'remove' : 'create'} feature "${module}/${name}" in apps/web/${project}`);
  for (const f of files) log(`  ${remove ? '-' : '+'} ${f.dest}`);
  for (const p of changed) log(`  ~ ${p.file}`);
  const result = { files: files.map((f) => f.dest), edited: changed.map((p) => p.file) };
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
  for (const p of changed) writeFileSync(path.join(root, p.file), p.after);

  if (!remove) {
    const others = readdirSync(path.join(moduleDir, 'features')).filter((entry) => entry !== name);
    if (others.length === 0) {
      log('  note: this is the module\'s first features/ folder. Move the capability that already lives in its ui/ and lib/ into a feature in the same change (rule 5 of modules-and-features.md).');
    }
    log(`  next: translate ${c.module}.${c.featureKey}.title in ru, tj, uz, ar; render it from a page through public.ts, or add a single-export ${moduleRel}/entries/${name}-view.ts when a Server Component imports it; run the project gates and task check:boundaries.`);
  }
  return result;
}

function main(argv) {
  const options = { root: path.resolve(HERE, '..') };
  for (const arg of argv) {
    if (arg.startsWith('MODULE=')) options.module = arg.slice(7);
    else if (arg.startsWith('NAME=')) options.name = arg.slice(5);
    else if (arg.startsWith('--project=')) options.project = arg.slice(10);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--remove') options.remove = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  scaffoldWebFeature(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`new-feature (web): ${err.message}`);
    process.exit(1);
  }
}

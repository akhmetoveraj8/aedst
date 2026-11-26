#!/usr/bin/env node
// Verifies ui-kit.yaml (component x platform x status, canonical variants and sizes) against the tree.
// Usage: node scripts/check-ui-kit.mjs [--write-docs] [--json]
//   default       fail when
//                   (a) an entry marked `implemented` has no file,
//                   (b) a kit file exists on any platform that the manifest does not list,
//                   (c) an entry is `missing` on any platform, or the reference platform (web) is not
//                       `implemented` for every entry (or aliased),
//                   (d) a declared variant/size differs from the web component's `cva` definition, or
//                       from the enums of an Android (.kt), Apple (.swift) or Desktop (.slint) kit file
//                       (names compared case-insensitively, separators ignored) without a matching
//                       `deviations:` entry that carries a reason,
//                   (e) the matrix in docs/content/ui-kit.md is not the one generated from the manifest.
//                 The parity report (implemented / native / missing per platform) is always printed.
//                   (f) an implemented component is not exercised on its platform: no story or test (web),
//                       no unit/UI test (Android, Apple), no compiled gallery page or UI test (Desktop);
//                       roots per platform under `coverage:`,
//                   (g) a name in a component's `props:` (its API contract) is not a parameter of a platform's file.
//   --write-docs  regenerate the matrix between the marker comments of docs/content/ui-kit.md.
// AEDST_UI_KIT_ROOT points the check at another tree (tests).
// Docs: docs/content/ui-kit.md
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cvaAxes } from './ui-kit/cva.mjs';
import { DOC_PATH, renderMatrix, spliceMatrix } from './ui-kit/docs.mjs';
import { coverageText, isCovered, missingProps, propUnion } from './ui-kit/coverage.mjs';
import { enumAxis, enumDeclarations, normalise } from './ui-kit/enums.mjs';

const { parse } = createRequire(import.meta.url)('yaml');
const STATUSES = new Set(['implemented', 'missing', 'native']);
const sameSet = (a, b) => a.length === b.length && a.every((v) => b.includes(v));
const names = (values) => [...new Set(values.map(normalise))];

/**
 * (d) on a native platform: every declared axis against the enums of the kit file. A platform that
 * differs on purpose lists its own values under `deviations.<platform>.<axis>: { values, reason }`.
 */
function checkEnumAxes({ c, p, file, src, fail, where }) {
  const declarations = enumDeclarations(src, path.extname(file));
  const deviations = c.deviations?.[p] ?? {};
  const declared = { variant: c.variants ?? [], size: c.sizes ?? [], ...(c.axes ?? {}) };
  for (const axis of Object.keys(deviations)) if (!(axis in declared)) fail(`${where}: deviation for unknown axis ${axis}`);
  for (const [axis, values] of Object.entries(declared)) {
    const actual = enumAxis(declarations, axis) ?? [];
    const deviation = deviations[axis];
    if (deviation) {
      if (typeof deviation.reason !== 'string' || !deviation.reason.trim()) fail(`${where}: deviation for ${axis} needs a reason`);
      if (!Array.isArray(deviation.values)) { fail(`${where}: deviation for ${axis} needs values (the platform's own list)`); continue; }
      if (sameSet(names(deviation.values), names(values))) fail(`${where}: deviation for ${axis} repeats the canonical values; remove it`);
      if (!sameSet(names(deviation.values), names(actual))) fail(`${where}: ${axis} deviation lists ${deviation.values.join(', ') || 'nothing'} but ${file} declares ${actual.join(', ') || 'nothing'}`);
      continue;
    }
    if (sameSet(names(values), names(actual))) continue;
    const absent = values.filter((v) => !names(actual).includes(normalise(v)));
    const extra = actual.filter((v) => !names(values).includes(normalise(v)));
    fail(`${where}: ${axis} differs from the enums in ${file}${absent.length ? `; declared but not in the file: ${absent.join(', ')}` : ''}${extra.length ? `; in the file but not declared: ${extra.join(', ')}` : ''} (fix the manifest or the component, or record it under deviations with a reason)`);
  }
}

/** Names under a platform root that count as kit components (files by extension; directories on web). */
function kitFiles(root, dir, rule) {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return null;
  return readdirSync(abs).filter((name) => {
    if (statSync(path.join(abs, name)).isDirectory()) return rule.directories === true; // web: sidebar/
    return name.endsWith(rule.ext) && !(rule.exclude_suffix ?? []).some((s) => name.endsWith(s)) && !(rule.not_components ?? []).includes(name);
  });
}

/** Source of a web component: one file, or every non-story .tsx of its directory. */
function webSources(abs) {
  if (!statSync(abs).isDirectory()) return [abs];
  return readdirSync(abs).filter((n) => n.endsWith('.tsx') && !/\.(stories|test)\.tsx$/.test(n)).map((n) => path.join(abs, n));
}

function hasStory(abs) {
  if (statSync(abs).isDirectory()) return readdirSync(abs).some((n) => n.endsWith('.stories.tsx'));
  return existsSync(abs.replace(/\.tsx$/, '.stories.tsx'));
}

export function checkUiKit(root) {
  const doc = parse(readFileSync(path.join(root, 'ui-kit.yaml'), 'utf8'));
  const errors = [];
  const fail = (m) => errors.push(m);
  const platforms = Object.keys(doc.platforms);
  const reference = platforms.find((p) => doc.platforms[p].reference);
  const report = Object.fromEntries(platforms.map((p) => [p, { implemented: 0, native: 0, missing: 0, missingNames: [] }]));
  const listed = Object.fromEntries(platforms.map((p) => [p, new Set()]));
  const covered = Object.fromEntries(platforms.map((p) => [p, coverageText(root, doc.coverage?.[p])]));

  const resolve = (name, seen = []) => {
    const c = doc.components[name];
    if (!c) return null;
    if (!c.alias) return c;
    return seen.includes(name) ? null : resolve(c.alias, [...seen, name]);
  };

  for (const [name, c] of Object.entries(doc.components)) {
    if (c.alias) {
      const target = resolve(name);
      if (!target) { fail(`${name}: alias ${c.alias} is not a component`); continue; }
      // An alias counts with its target on every platform.
      for (const p of platforms) if (target[p]?.status in report[p]) report[p][target[p].status]++;
      continue;
    }
    for (const key of ['variants', 'sizes']) if (!Array.isArray(c[key])) fail(`${name}: ${key} must be a list (use [] for none)`);
    for (const p of Object.keys(c.deviations ?? {})) {
      if (!platforms.includes(p) || p === reference) fail(`${name}: deviations.${p} is not a non-reference platform`);
      else if (c[p]?.status !== 'implemented') fail(`${name}: deviations.${p} needs an implemented entry`);
    }
    for (const p of platforms) {
      const e = c[p];
      const where = `${name} on ${p}`;
      if (!e) { fail(`${where}: no entry`); continue; }
      if (!STATUSES.has(e.status)) { fail(`${where}: unknown status ${e.status}`); continue; }
      report[p][e.status]++;
      if (e.status === 'missing') report[p].missingNames.push(name);
      if (e.status !== 'implemented' && e.file) fail(`${where}: ${e.status} must not carry a file`);
      if (e.status === 'native' && !e.note) fail(`${where}: native needs note`);
      if (e.status === 'missing') fail(`${where}: missing (every platform implements the whole kit; use native with a note when the SDK provides it)`); // (c)
      if (e.status === 'native' && p === reference) fail(`${where}: the reference platform must implement every component`); // (c)
      if (e.status !== 'implemented') continue;
      if (!e.file) { fail(`${where}: implemented needs file`); continue; }
      if (listed[p].has(e.file)) fail(`${where}: ${e.file} is listed twice`);
      listed[p].add(e.file);
      const abs = path.join(root, doc.platforms[p].root, e.file);
      if (!existsSync(abs)) { fail(`${where}: ${doc.platforms[p].root}/${e.file} does not exist`); continue; } // (a)
      const src = webSources(abs).map((f) => readFileSync(f, 'utf8')).join('\n');
      if (!isCovered(covered[p], e.file, src)) fail(`${where}: not exercised by any ${p} test, story or gallery page (coverage roots in ui-kit.yaml)`); // (f)
      const absentProps = missingProps(c.props, src);
      if (absentProps.length) fail(`${where}: props contract not met, ${e.file} has no ${absentProps.join(', ')}`); // (g)
      if (p !== reference) {
        if (statSync(abs).isFile()) checkEnumAxes({ c, p, file: e.file, src, fail, where }); // (d)
        continue;
      }
      if (doc.kit_files[p].require_story && !hasStory(abs)) fail(`${where}: no .stories.tsx next to ${e.file}`);
      // (d) the manifest and the cva definitions agree, both ways.
      const axes = {};
      for (const f of webSources(abs)) for (const [k, v] of Object.entries(cvaAxes(readFileSync(f, 'utf8')))) axes[k] = [...new Set([...(axes[k] ?? []), ...v])];
      const declared = { variant: c.variants ?? [], size: c.sizes ?? [], ...(c.axes ?? {}) };
      for (const [axis, values] of Object.entries(declared)) {
        // An axis outside cva may be a string-literal union prop (`size?: "default" | "sm" | "lg"`).
        const actual = axes[axis] ?? propUnion(src, axis) ?? [];
        if (sameSet(values, actual)) continue;
        const absent = values.filter((v) => !actual.includes(v));
        const extra = actual.filter((v) => !values.includes(v));
        fail(`${where}: ${axis} differs from cva (or the prop union) in ${e.file}${absent.length ? `; declared but not in cva: ${absent.join(', ')}` : ''}${extra.length ? `; in cva but not declared: ${extra.join(', ')}` : ''}`);
      }
    }
  }

  // Extensions exist; (b) every kit file is listed as a component or an extension.
  for (const p of platforms) {
    const dir = doc.platforms[p].root;
    for (const f of doc.extensions?.[p] ?? []) {
      if (listed[p].has(f)) fail(`${p}: ${f} is both a component and an extension`);
      listed[p].add(f);
      if (!existsSync(path.join(root, dir, f))) fail(`${p}: extension ${dir}/${f} does not exist`);
    }
    const present = kitFiles(root, dir, doc.kit_files?.[p] ?? {});
    if (!present) { fail(`platforms.${p}.root: ${dir} does not exist`); continue; }
    for (const f of present) if (!listed[p].has(f)) fail(`${p}: undeclared kit file ${dir}/${f} (add it to ui-kit.yaml: components or extensions)`);
  }

  return { doc, errors, report, platforms };
}

function main() {
  const root = process.env.AEDST_UI_KIT_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = new Set(process.argv.slice(2));
  const { doc, errors, report, platforms } = checkUiKit(root);
  const total = Object.keys(doc.components).length;

  // (e) docs in sync (or rewrite them).
  const docFile = path.join(root, DOC_PATH);
  if (existsSync(docFile)) {
    const text = readFileSync(docFile, 'utf8').replace(/\r\n/g, '\n');
    const next = spliceMatrix(text, renderMatrix(doc, report));
    if (next === null) errors.push(`${DOC_PATH}: matrix markers not found`);
    else if (args.has('--write-docs')) {
      if (next !== text) writeFileSync(docFile, next);
      console.log(`${DOC_PATH}: matrix ${next === text ? 'already up to date' : 'rewritten'}`);
    } else if (next !== text) errors.push(`${DOC_PATH}: matrix is out of date; run \`node scripts/check-ui-kit.mjs --write-docs\``);
  } else errors.push(`${DOC_PATH} does not exist`);

  if (args.has('--json')) console.log(JSON.stringify({ errors, report }, null, 2));
  else {
    console.log(`ui-kit.yaml: ${total} components x ${platforms.length} platforms`);
    console.log('parity report (implemented / native / missing of ' + total + '):');
    for (const p of platforms) {
      const r = report[p];
      console.log(`  ${p.padEnd(8)} ${String(r.implemented).padStart(2)} / ${String(r.native).padStart(2)} / ${String(r.missing).padStart(2)}`);
      if (r.missingNames.length) console.log(`           missing: ${r.missingNames.join(', ')}`);
    }
    if (errors.length) console.error('\nFAIL:\n  ' + errors.join('\n  '));
    else console.log('OK: ui-kit.yaml matches the tree.');
  }
  process.exit(errors.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

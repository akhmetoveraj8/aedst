#!/usr/bin/env node
// Generates the component reference of the docs site from ui-kit.yaml and the kit sources: one page
// per manifest entry with the canonical variants and sizes and, per platform, the status, the source
// file, the public API extracted from that file and a usage example. Output (never edit by hand):
//   docs/content/ui-kit/components/<name>.mdx   one page per component
//   docs/content/ui-kit/components/index.mdx    the list with the name on every platform
//   docs/content/ui-kit/components/meta.json, docs/content/ui-kit/meta.json   navigation
// Usage:
//   node scripts/ui-kit/component-docs.mjs           write the pages (`task docs:ui-kit`)
//   node scripts/ui-kit/component-docs.mjs --check   exit 1 when a committed page is stale
// AEDST_UI_KIT_ROOT points the generator at another tree (tests).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADER, PAGES_DIR, PLATFORMS, platformName, renderAlias, renderIndex, renderPage } from './component-page.mjs';
import { extractAndroid } from './extract-android.mjs';
import { extractApple } from './extract-apple.mjs';
import { extractDesktop } from './extract-desktop.mjs';
import { extractWeb } from './extract-web.mjs';
import { lf, pascal } from './source.mjs';

const { parse } = createRequire(import.meta.url)('yaml');
const read = (file) => lf(readFileSync(file, 'utf8'));
const sorted = (dir) => readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Web: the component's sources, its stories and the import path (a file, or a directory like sidebar/). */
function webInput(root, platformRoot, file) {
  const abs = path.join(root, platformRoot, file);
  const alias = `@/${platformRoot.replace(/^apps\/web\//, '')}/${file.replace(/\.tsx$/, '')}`;
  if (!statSync(abs).isDirectory()) {
    const stories = abs.replace(/\.tsx$/, '.stories.tsx');
    return { sources: [{ path: file, src: read(abs) }], stories: existsSync(stories) ? read(stories) : null, alias, repoPath: `${platformRoot}/${file}` };
  }
  const names = sorted(abs);
  const story = names.find((n) => n.endsWith('.stories.tsx'));
  return {
    sources: names.filter((n) => /\.tsx?$/.test(n) && !/\.(stories|test)\.tsx?$/.test(n)).map((n) => ({ path: `${file}/${n}`, src: read(path.join(abs, n)) })),
    stories: story ? read(path.join(abs, story)) : null,
    alias,
    repoPath: `${platformRoot}/${file}/`,
  };
}

/** Desktop gallery sources, in a stable order: where usage examples come from. */
function gallerySources(root, desktopRoot) {
  const dir = path.join(root, desktopRoot, 'gallery');
  if (!existsSync(dir)) return [];
  return sorted(dir).filter((n) => n.endsWith('.slint')).map((n) => ({ path: `${desktopRoot}/gallery/${n}`, src: read(path.join(dir, n)) }));
}

/**
 * Everything the generator would write: { pages: Map<repo path, text>, warnings: [..], stats }.
 * `stats[platform]`: { implemented, minimal, noSignature }.
 */
export function generate(root) {
  const doc = parse(read(path.join(root, 'ui-kit.yaml')));
  const platforms = Object.keys(PLATFORMS);
  const gallery = gallerySources(root, doc.platforms.desktop.root);
  const pages = new Map();
  const warnings = [];
  const stats = Object.fromEntries(platforms.map((p) => [p, { implemented: 0, minimal: 0, noSignature: 0 }]));
  const rows = [];
  const namesOf = {};

  for (const [name, c] of Object.entries(doc.components)) {
    if (c.alias) continue;
    const sources = {};
    const extracted = {};
    for (const p of platforms) {
      const entry = c[p];
      if (entry?.status !== 'implemented') continue;
      const platformRoot = doc.platforms[p].root;
      const base = path.posix.basename(entry.file).replace(/\.\w+$/, '');
      sources[p] = `${platformRoot}/${entry.file}`;
      if (p === 'web') {
        const input = webInput(root, platformRoot, entry.file);
        sources[p] = input.repoPath;
        extracted[p] = extractWeb(name, input.sources, input.stories, input.alias);
      } else {
        const src = read(path.join(root, platformRoot, entry.file));
        if (p === 'android') extracted[p] = extractAndroid(src, base, pascal(name));
        else if (p === 'apple') extracted[p] = extractApple(src, base, pascal(name));
        else extracted[p] = extractDesktop(src, base, gallery);
      }
      stats[p].implemented++;
      if (!extracted[p].signatures) {
        stats[p].noSignature++;
        warnings.push(`${name} on ${p}: no signature extracted from ${sources[p]}`);
      }
      if (extracted[p].example?.kind === 'minimal') stats[p].minimal++;
      if (!extracted[p].example) warnings.push(`${name} on ${p}: no example`);
    }
    pages.set(`${PAGES_DIR}/${name}.mdx`, renderPage(name, c, sources, extracted));
    namesOf[name] = Object.fromEntries(platforms.map((p) => [p, `${c[p].status === 'native' ? 'native: ' : ''}${platformName(p, c, extracted[p])}`]));
  }
  for (const [name, c] of Object.entries(doc.components)) {
    const names = namesOf[c.alias ?? name];
    if (!names) { warnings.push(`${name}: alias target ${c.alias} has no page`); continue; }
    if (c.alias) pages.set(`${PAGES_DIR}/${name}.mdx`, renderAlias(name, c.alias, names));
    rows.push({ name, alias: c.alias, names });
  }
  pages.set(`${PAGES_DIR}/index.mdx`, renderIndex(rows));
  pages.set(`${PAGES_DIR}/meta.json`, `${JSON.stringify({ title: 'Components', defaultOpen: false, pages: ['index', ...rows.map((r) => r.name)] }, null, 2)}\n`);
  pages.set(`${path.posix.dirname(PAGES_DIR)}/meta.json`, `${JSON.stringify({ title: 'UI kit', pages: ['components'] }, null, 2)}\n`);
  return { pages, warnings, stats };
}

/** Generated pages on disk that the manifest no longer has. */
function orphans(root, pages) {
  const dir = path.join(root, PAGES_DIR);
  if (!existsSync(dir)) return [];
  return sorted(dir).filter((n) => n.endsWith('.mdx')).map((n) => `${PAGES_DIR}/${n}`)
    .filter((p) => !pages.has(p) && read(path.join(root, p)).includes(HEADER));
}

function main() {
  const root = process.env.AEDST_UI_KIT_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const check = process.argv.includes('--check');
  const { pages, warnings, stats } = generate(root);
  const stale = [];
  for (const [name, text] of pages) {
    const file = path.join(root, name);
    if (existsSync(file) && read(file) === text) continue;
    stale.push(name);
    if (!check) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
  }
  const removed = orphans(root, pages);
  if (!check) for (const name of removed) unlinkSync(path.join(root, name));
  for (const w of warnings) console.warn(`warning: ${w}`);
  for (const [p, s] of Object.entries(stats)) {
    console.log(`  ${p.padEnd(8)} ${String(s.implemented).padStart(2)} implemented, ${s.minimal} minimal example(s), ${s.noSignature} without a signature`);
  }
  if (check && (stale.length || removed.length)) {
    console.error(`stale component pages: ${[...stale, ...removed].join(', ')} (run: task docs:ui-kit)`);
    process.exit(1);
  }
  const count = [...pages.keys()].filter((p) => p.endsWith('.mdx')).length;
  console.log(`${count} component reference pages ${check ? 'up to date' : `written (${stale.length} changed, ${removed.length} removed)`}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

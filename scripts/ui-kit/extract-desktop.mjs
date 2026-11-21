// Public API and usage example of a Desktop (Slint) kit file, for the component reference.
// Reads: every `export component` with its `in` / `out` / `in-out` properties, callbacks and public
// functions, `export struct` blocks, the enums (enums.mjs) and a usage from the kit gallery.
import { enumDeclarations, normalise } from './enums.mjs';
import { closeOf, dedent, docBefore, mask } from './source.mjs';

const COMPONENT = /^export\s+component\s+(\w+)(?:\s+inherits\s+\w+)?\s*\{/gm;
const STRUCT = /^export\s+struct\s+\w+\s*\{/gm;
const API = /^(?:(?:in|out|in-out)\s+property\b|(?:pure\s+)?callback\b|public\s+(?:pure\s+)?function\b)/;

/** Top-level statements of a component body that are part of its interface, one line each. */
function interfaceLines(src, masked, open, close) {
  const lines = [];
  let i = open + 1;
  while (i < close) {
    if (/\s/.test(masked[i])) { i++; continue; }
    // One item: up to `;` at depth 0, or a `{ ... }` block (element, handler, function body).
    let depth = 0;
    let j = i;
    let block = -1;
    for (; j < close; j++) {
      const c = masked[j];
      if (c === '{' && depth === 0) { block = j; break; }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ';' && depth === 0) break;
    }
    const head = masked.slice(i, j);
    if (API.test(head)) {
      const text = src.slice(i, j).replace(/\s*\n\s*/g, ' ').trim();
      // `callback x => { ... }` and bindings in a block keep only the declaration.
      lines.push(`${text.replace(/\s*(=>|:)\s*$/, '')};`);
    }
    i = block === -1 ? j + 1 : closeOf(masked, block) + 1;
    if (i === 0) break;
  }
  return lines;
}

/** Exported components of a Slint file: [{ name, index, text }]. */
export function slintComponents(src) {
  const masked = mask(src);
  const components = [];
  for (const hit of masked.matchAll(COMPONENT)) {
    const open = hit.index + hit[0].length - 1;
    const close = closeOf(masked, open);
    if (close === -1) continue;
    const lines = interfaceLines(src, masked, open, close);
    const header = src.slice(hit.index, open).trim();
    components.push({ name: hit[1], index: hit.index, members: lines.length, text: lines.length ? `${header} {\n${lines.map((l) => `    ${l}`).join('\n')}\n}` : `${header} { }` });
  }
  return components;
}

function slintStructs(src) {
  const masked = mask(src);
  return [...masked.matchAll(STRUCT)].map((hit) => {
    const close = closeOf(masked, hit.index + hit[0].length - 1);
    return close === -1 ? null : src.slice(hit.index, close + 1);
  }).filter(Boolean);
}

/**
 * First instantiation of one of `names` in the gallery sources ([{ path, src }], in order):
 * { code, path } or null. The whole element block is returned.
 */
export function galleryUsage(names, gallery) {
  for (const name of names) {
    for (const { path, src } of gallery) {
      const masked = mask(src);
      const hit = new RegExp(`(?<![\\w-])(?:[\\w-]+\\s*:=\\s*)?${name}\\s*\\{`).exec(masked);
      if (!hit || /\b(component|inherits)\s+$/.test(masked.slice(0, hit.index))) continue;
      const close = closeOf(masked, hit.index + hit[0].length - 1);
      if (close === -1) continue;
      const lineStart = src.lastIndexOf('\n', hit.index) + 1;
      const indent = ' '.repeat(hit.index - lineStart);
      return { code: dedent(`${indent}${src.slice(hit.index, close + 1)}`), path };
    }
  }
  return null;
}

/**
 * { names, doc, api, enums, example: { code, kind } | null, signatures } of one kit file.
 * `kind` is `gallery` (a usage found in the kit gallery) or `minimal` (the default variant only).
 */
export function extractDesktop(src, base, gallery) {
  const components = slintComponents(src);
  const main = components.find((c) => normalise(c.name) === normalise(base)) ?? components[0];
  const enums = enumDeclarations(src, '.slint');
  const api = [
    ...enums.map((e) => `export enum ${e.name} { ${e.values.join(', ')} }`),
    ...slintStructs(src).map((s) => dedent(s)),
    ...components.map((c) => c.text),
  ].join('\n\n');
  const names = main ? [main.name, ...components.filter((c) => c !== main).map((c) => c.name)] : [];
  const usage = galleryUsage(names, gallery);
  let example = null;
  if (usage) example = { code: usage.code, kind: 'gallery', from: `the kit gallery, \`${usage.path}\`` };
  else if (main) {
    const variant = enums.find((e) => normalise(e.name) === normalise(`${main.name}Variant`));
    const value = variant?.values.includes('default') ? 'default' : variant?.values[0];
    example = { code: variant ? `${main.name} { variant: ${variant.name}.${value}; }` : `${main.name} { }`, kind: 'minimal' };
  }
  return {
    names: components.map((c) => c.name),
    main: main?.name ?? null,
    doc: main ? docBefore(src, main.index, 'line') : null,
    api: api || null,
    enums,
    example,
    signatures: components.length,
  };
}

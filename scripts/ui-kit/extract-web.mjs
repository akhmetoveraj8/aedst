// Public API and usage example of a web kit component (one .tsx file, or the files of a directory),
// for the component reference. Reads: the exported names, the signature of every exported function,
// `...Props` and exported types, the `cva` axes (cva.mjs) and the first story of `<name>.stories.tsx`.
import { cvaAxes, objectEntries } from './cva.mjs';
import { closeOf, dedent, docBefore, mask, pascal } from './source.mjs';

/** Names a module exports: [{ name, isType }], in source order. */
export function exportedNames(src) {
  const masked = mask(src);
  const found = [];
  const add = (name, isType) => { if (!found.some((f) => f.name === name)) found.push({ name, isType }); };
  for (const m of masked.matchAll(/^export\s+(type\s+)?\{([^}]*)\}|^export\s+(?:default\s+)?(?:async\s+)?(function|const|type|interface)\s+(\w+)/gm)) {
    if (m[4]) { add(m[4], m[3] === 'type' || m[3] === 'interface'); continue; }
    for (const part of m[2].split(',')) {
      const p = /^\s*(type\s+)?(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
      if (p) add(p[3] ?? p[2], Boolean(m[1] || p[1]));
    }
  }
  return found;
}

/** `function Name(...)` declarations: [{ name, index, signature }] (the signature stops before the body). */
export function functionSignatures(src) {
  const masked = mask(src);
  const found = [];
  for (const m of masked.matchAll(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^(]*>)?\s*\(/gm)) {
    const close = closeOf(masked, m.index + m[0].length - 1);
    if (close === -1) continue;
    const body = masked.indexOf('{', close);
    const start = m.index + m[0].indexOf('function');
    const end = body === -1 ? close + 1 : body;
    found.push({ name: m[1], index: m.index, signature: src.slice(start, end).trim(), end: body === -1 ? -1 : closeOf(masked, body) });
  }
  return found;
}

/** `interface X { }` and `type X = ...;` declarations: [{ name, index, text }]. */
export function typeDeclarations(src) {
  const masked = mask(src);
  const found = [];
  for (const m of masked.matchAll(/^(?:export\s+)?(interface|type)\s+(\w+)/gm)) {
    let end;
    if (m[1] === 'interface') end = closeOf(masked, masked.indexOf('{', m.index)) + 1;
    else {
      let depth = 0;
      for (end = m.index; end < masked.length; end++) {
        if ('{[('.includes(masked[end])) depth++;
        else if ('}])'.includes(masked[end])) depth--;
        else if (masked[end] === ';' && depth === 0) { end++; break; }
      }
    }
    if (end > m.index) found.push({ name: m[2], index: m.index, text: src.slice(m.index, end).replace(/^export\s+/, '') });
  }
  return found;
}

/** Entries of the object literal opened at `open`: { key: source text of the value }. */
function objectValues(src, masked, open) {
  const close = closeOf(masked, open);
  const entries = objectEntries(masked, open);
  const values = {};
  for (const e of entries) {
    let end = close;
    let depth = 0;
    for (let k = e.valueStart; k < close; k++) {
      if ('{[('.includes(masked[k])) depth++;
      else if ('}])'.includes(masked[k])) depth--;
      else if (masked[k] === ',' && depth === 0) { end = k; break; }
    }
    // A quoted key is blank in the masked text: read it back from the source.
    const key = e.key.trim() || /([^"']+)["']\s*:\s*$/.exec(src.slice(0, e.valueStart))?.[1];
    values[key] = src.slice(e.valueStart, end).trim();
  }
  return values;
}

/** `(args) => ( <jsx/> )`, `() => <jsx/>` or `() => { ... }` reduced to what it returns. */
function arrowBody(text) {
  const arrow = /^(?:\([^)]*\)|\w+)\s*=>\s*/.exec(text);
  if (!arrow) return null;
  const body = text.slice(arrow[0].length).trim();
  if ('({'.includes(body[0]) && closeOf(mask(body), 0) === body.length - 1) return dedent(body.slice(1, -1));
  return dedent(body);
}

/** JSX for a component rendered with the given args (source text per prop). */
function jsxFromArgs(component, args) {
  const props = [];
  let children = '';
  for (const [key, value] of Object.entries(args)) {
    if (key === 'children') children = /^"[^"\n]*"$/.test(value) ? value.slice(1, -1) : `{${value}}`;
    else if (value === 'true') props.push(key);
    else props.push(/^"[^"\n]*"$/.test(value) ? `${key}=${value}` : `${key}={${value.replace(/\s*\n\s*/g, ' ')}}`);
  }
  const inline = [component, ...props].join(' ');
  const open = inline.length > 90 ? `${component}\n${props.map((p) => `  ${p}`).join('\n')}\n` : inline;
  if (open !== inline) return children ? `<${open}>\n  ${children}\n</${component}>` : `<${open}/>`;
  return children ? `<${open}>${children}</${component}>` : `<${open} />`;
}

/**
 * Example from a stories file: the first story's `render`, else the local wrapper component the
 * stories render, else JSX built from the meta and story args. { code, story } or null.
 */
export function storyExample(stories) {
  const masked = mask(stories);
  const metaHit = /const\s+meta\s*=\s*\{/.exec(masked);
  const storyHit = /^export\s+const\s+(\w+)\s*:\s*\w+\s*=\s*\{/m.exec(masked);
  if (!metaHit || !storyHit) return null;
  const meta = objectValues(stories, masked, metaHit.index + metaHit[0].length - 1);
  const story = objectValues(stories, masked, storyHit.index + storyHit[0].length - 1);
  const argsOf = (text) => (text?.startsWith('{') ? objectValues(text, mask(text), 0) : {});
  const metaArgs = meta.args?.replace(/\s*\n\s*/g, ' ');
  if (story.render) {
    const body = arrowBody(story.render);
    if (!body) return null;
    const note = /\bargs\b/.test(body) && metaArgs ? `// args: ${metaArgs}\n` : '';
    return { code: `${note}${body}`, story: storyHit[1] };
  }
  const component = meta.component;
  if (!component || !/^\w+$/.test(component)) return null;
  const wrapper = functionSignatures(stories).find((f) => f.name === component && f.end !== -1);
  if (wrapper) return { code: dedent(stories.slice(stories.lastIndexOf('\n', wrapper.index) + 1, wrapper.end + 1)), story: storyHit[1] };
  const jsx = jsxFromArgs(component, { ...argsOf(meta.args), ...argsOf(story.args) });
  return jsx ? { code: jsx, story: storyHit[1] } : null;
}

/**
 * { names, doc, api, axes, example: { code, kind } | null, signatures } of a web component.
 * `sources`: [{ path, src }] (one file, or the directory's files; `index.ts` supplies the exports when
 * present); `stories`: source of the stories file or null; `importPath`: what a caller imports from.
 */
export function extractWeb(name, sources, stories, importPath) {
  const index = sources.find((s) => /(^|\/)index\.ts$/.test(s.path));
  const exported = index ? exportedNames(index.src) : sources.flatMap((s) => exportedNames(s.src));
  const isExported = (n) => exported.some((e) => e.name === n);
  const blocks = [];
  let signatures = 0;
  let doc = null;
  const mainName = isExported(pascal(name)) ? pascal(name) : exported.find((e) => !e.isType && /^[A-Z]/.test(e.name))?.name;
  const axes = {};
  for (const { src } of sources) {
    for (const [axis, values] of Object.entries(cvaAxes(src))) axes[axis] = [...new Set([...(axes[axis] ?? []), ...values])];
    for (const t of typeDeclarations(src)) if (isExported(t.name) || /Props$/.test(t.name)) blocks.push(dedent(t.text));
    for (const f of functionSignatures(src)) {
      if (!isExported(f.name)) continue;
      blocks.push(f.signature);
      signatures++;
      if (f.name === mainName) doc = docBefore(src, f.index);
    }
  }
  const imported = exported.map((e) => (e.isType ? `type ${e.name}` : e.name));
  const inline = `import { ${imported.join(', ')} } from "${importPath}";`;
  const wrapped = ['import {', ...imported.map((n) => `  ${n},`), `} from "${importPath}";`].join('\n');
  const importLine = !exported.length ? null : inline.length <= 100 ? inline : wrapped;
  const story = stories ? storyExample(stories) : null;
  let example = null;
  if (story) example = { code: story.code, kind: 'story', from: `the \`${story.story}\` story` };
  else if (mainName) example = { code: `<${mainName}${axes.variant?.includes('default') ? ' variant="default"' : ''} />`, kind: 'minimal' };
  return {
    names: exported.filter((e) => !e.isType).map((e) => e.name),
    main: mainName ?? null,
    doc,
    api: [importLine, ...blocks].filter(Boolean).join('\n\n') || null,
    axes,
    example,
    signatures,
  };
}

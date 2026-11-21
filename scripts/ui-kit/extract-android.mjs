// Public API and usage example of an Android (Jetpack Compose) kit file, for the component reference.
// Reads: public `@Composable fun` signatures, public classes with their constructor, the enums
// (enums.mjs) and the body of the first `@Preview` function.
import { enumDeclarations, normalise } from './enums.mjs';
import { closeOf, dedent, docBefore, mask, splitTop } from './source.mjs';

const FUN = /^((?:(?:public|inline|internal|private|override|suspend)\s+)*)fun\s+(?:<[^>\n]*>\s+)?(?:[\w.<>]+\.)?(\w+)\s*\(/gm;
const TYPE = /^((?:(?:data|sealed|value|abstract|open|fun)\s+)*(?:class|interface)\s+\w+(?:<[^>\n]*>)?)[ \t]*(\(?)/gm;

/** Annotation lines directly above the declaration at `index` (`@Composable`, `@Preview(...)`). */
function annotationsAbove(src, index) {
  const lines = src.slice(0, index).split('\n');
  lines.pop();
  const found = [];
  while (lines.length && /^\s*@/.test(lines.at(-1))) found.unshift(lines.pop().trim());
  return found;
}

/** Every top-level function: { name, modifiers, annotations, index, open, close, signature, params, body }. */
export function kotlinFunctions(src) {
  const masked = mask(src);
  const functions = [];
  for (const hit of masked.matchAll(FUN)) {
    const open = hit.index + hit[0].length - 1;
    const close = closeOf(masked, open);
    if (close === -1) continue;
    const tail = /^\s*(:\s*[^={\n]+)?/.exec(masked.slice(close + 1));
    const returns = tail[1] ? src.slice(close + 1, close + 1 + tail[0].length).trim() : '';
    const bodyOpen = masked.indexOf('{', close);
    const bodyClose = bodyOpen === -1 ? -1 : closeOf(masked, bodyOpen);
    functions.push({
      name: hit[2],
      modifiers: hit[1],
      annotations: annotationsAbove(src, hit.index),
      index: hit.index,
      signature: `${src.slice(hit.index, close + 1)}${returns ? `${returns.startsWith(':') ? '' : ' '}${returns}` : ''}`,
      params: splitTop(src.slice(open + 1, close)),
      body: bodyClose === -1 ? null : src.slice(bodyOpen + 1, bodyClose),
    });
  }
  return functions;
}

const isPublic = (f) => !/\b(private|internal)\b/.test(f.modifiers);
const isComposable = (f) => f.annotations.some((a) => a.startsWith('@Composable'));
const isPreview = (f) => f.annotations.some((a) => a.startsWith('@Preview'));

/** Public classes and interfaces with their primary constructor: [{ index, text }]. */
function publicTypes(src) {
  const masked = mask(src);
  const types = [];
  for (const hit of masked.matchAll(TYPE)) {
    let end = hit.index + hit[1].length;
    if (hit[2]) {
      const close = closeOf(masked, hit.index + hit[0].length - 1);
      if (close !== -1) end = close + 1;
    }
    types.push({ index: hit.index, text: src.slice(hit.index, end) });
  }
  return types;
}

/** A value for a required parameter of the given Kotlin type (minimal example only). */
function placeholder(type, title) {
  const t = type.replace(/^@\w+\s+/, '').trim();
  if (/\?$/.test(t)) return 'null';
  if (t.includes('->')) {
    const head = /\(([^)]*)\)\s*->/.exec(t);
    const count = head && head[1].trim() ? splitTop(head[1]).length : 0;
    return count > 1 ? `{ ${Array(count).fill('_').join(', ')} -> }` : '{}';
  }
  if (t === 'String') return JSON.stringify(title);
  if (t === 'Boolean') return 'false';
  if (/^(Int|Long)$/.test(t)) return '0';
  if (/^(Float|Double)$/.test(t)) return t === 'Float' ? '0f' : '0.0';
  if (/^(List|Set|Map)</.test(t)) return `empty${/^\w+/.exec(t)[0]}()`;
  if (t === 'Modifier') return 'Modifier';
  return `TODO("${t.replace(/"/g, "'")}")`;
}

/** A call with every required parameter and the default variant and size, from the signature. */
export function minimalKotlinCall(fn, title) {
  const args = [];
  for (const param of fn.params) {
    const m = /^(?:vararg\s+)?(\w+)\s*:\s*([\s\S]+?)(?:\s+=\s+([\s\S]+))?$/.exec(param);
    if (!m) continue;
    const [, name, type, fallback] = m;
    if (fallback === undefined) args.push(`${name} = ${placeholder(type, title)}`);
    else if (/^(variant|size)$/.test(name)) args.push(`${name} = ${fallback.trim()}`);
  }
  return `${fn.name}(${args.join(', ')})`;
}

/**
 * { names, doc, api, enums, example: { code, kind } | null, signatures } of one kit file.
 * `kind` is `preview` (the `@Preview` body) or `minimal` (built from the signature).
 */
export function extractAndroid(src, base, title) {
  const functions = kotlinFunctions(src);
  const composables = functions.filter((f) => isComposable(f) && isPublic(f) && !isPreview(f));
  const main = composables.find((f) => normalise(f.name) === normalise(base)) ?? composables[0];
  const enums = enumDeclarations(src, '.kt');
  const declarations = [
    ...publicTypes(src),
    ...composables.map((f) => ({ index: f.index, text: `@Composable\n${f.signature}` })),
  ].sort((a, b) => a.index - b.index);
  const api = [
    ...enums.map((e) => `enum class ${e.name} { ${e.values.join(', ')} }`),
    ...declarations.map((d) => dedent(d.text)),
  ].join('\n\n');
  const preview = functions.find((f) => isPreview(f) && f.body);
  let example = null;
  if (preview) example = { code: dedent(preview.body), kind: 'preview', from: `the \`@Preview\` function \`${preview.name}\`` };
  else if (main) example = { code: minimalKotlinCall(main, title), kind: 'minimal' };
  return {
    names: composables.map((f) => f.name).filter((n, i, all) => all.indexOf(n) === i),
    main: main?.name ?? null,
    doc: main ? docBefore(src, main.index) : null,
    api: api || null,
    enums,
    example,
    signatures: composables.length,
  };
}

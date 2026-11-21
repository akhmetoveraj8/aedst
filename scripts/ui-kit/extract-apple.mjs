// Public API and usage example of an Apple (SwiftUI) kit file, for the component reference.
// Reads: `public struct` / `extension` containers with their public `init` and `func` signatures,
// the enums (enums.mjs) and the body of the first `#Preview` block.
import { enumDeclarations, normalise } from './enums.mjs';
import { closeOf, dedent, docBefore, mask, splitTop } from './source.mjs';

const CONTAINER = /^((?:public\s+)?(?:final\s+)?(?:struct|class|extension)\s+[^\n{]+?)\s*\{/gm;
const MEMBER = /^[ \t]+((?:@\w+(?:\([^)\n]*\))?\s+)*)(public\s+)?((?:static\s+)?(?:init\??|func\s+\w+))\s*(?:<[^>(\n]*>)?\s*\(/gm;

/** Containers of a Swift file: [{ header, name, isPublic, index, members: [{ kind, signature, params }] }]. */
export function swiftContainers(src) {
  const masked = mask(src);
  const containers = [];
  for (const hit of masked.matchAll(CONTAINER)) {
    const open = hit.index + hit[0].length - 1;
    const close = closeOf(masked, open);
    if (close === -1) continue;
    const header = src.slice(hit.index, hit.index + hit[1].length);
    const isPublic = header.startsWith('public');
    const members = [];
    const body = masked.slice(open + 1, close);
    for (const m of body.matchAll(MEMBER)) {
      if (!m[2] && !(isPublic && header.includes('extension'))) continue;
      // Direct members only: no unclosed brace between the container and the member.
      const before = body.slice(0, m.index);
      if (before.split('{').length !== before.split('}').length) continue;
      const start = open + 1 + m.index;
      const paren = start + m[0].length - 1;
      const end = closeOf(masked, paren);
      if (end === -1) continue;
      const brace = masked.indexOf('{', end);
      const tail = src.slice(end + 1, brace === -1 || brace > close ? end + 1 : brace).trim();
      members.push({
        kind: m[3].replace(/\s+/g, ' '),
        signature: `${dedent(src.slice(start, end + 1))}${tail ? ` ${tail}` : ''}`,
        params: splitTop(src.slice(paren + 1, end)),
      });
    }
    const name = /(?:struct|class|extension)\s+(\w+)/.exec(header)[1];
    containers.push({ header, name, isPublic, index: hit.index, members });
  }
  return containers;
}

/** A value for a required parameter of the given Swift type (minimal example only). */
function placeholder(type, title) {
  const t = type.replace(/@\w+(\([^)]*\))?\s+/g, '').trim();
  if (/\?$/.test(t)) return 'nil';
  if (t.includes('->')) {
    const head = /\(([^)]*)\)\s*->\s*(.+)$/.exec(t);
    const count = head && head[1].trim() ? splitTop(head[1]).length : 0;
    const body = head && !/^(Void|\(\))$/.test(head[2].trim()) ? `Text(${JSON.stringify(title)})` : '';
    const args = count ? `${Array(count).fill('_').join(', ')} in` : '';
    return `{ ${[args, body].filter(Boolean).join(' ')} }`.replace('{  }', '{}');
  }
  if (t === 'String') return JSON.stringify(title);
  if (t === 'Bool') return 'false';
  if (/^(Int|Double|CGFloat|Float)$/.test(t)) return '0';
  const binding = /^Binding<(.+)>$/.exec(t);
  if (binding) return `.constant(${placeholder(binding[1], title)})`;
  if (/^\[.*\]$/.test(t)) return '[]';
  return `/* ${t} */`;
}

/** A call with every required parameter and the default variant and size, from an `init` signature. */
export function minimalSwiftCall(name, params, title) {
  const args = [];
  for (const param of params) {
    const m = /^((?:@\w+(?:\([^)]*\))?\s+)*)(\w+)(?:\s+(\w+))?\s*:\s*([\s\S]+?)(?:\s+=\s+([\s\S]+))?$/.exec(param);
    if (!m) continue;
    const [, , label, , type, fallback] = m;
    const prefix = label === '_' ? '' : `${label}: `;
    if (fallback === undefined) args.push(`${prefix}${placeholder(type, title)}`);
    else if (/^(variant|size)$/.test(label)) args.push(`${prefix}${fallback.trim()}`);
  }
  return `${name}(${args.join(', ')})`;
}

const swiftCase = (value) => (value === 'default' ? '`default`' : value);

/**
 * { names, doc, api, enums, example: { code, kind } | null, signatures } of one kit file.
 * `kind` is `preview` (the `#Preview` body) or `minimal` (built from the initialiser).
 */
export function extractApple(src, base, title) {
  const masked = mask(src);
  const containers = swiftContainers(src);
  const shown = containers.filter((c) => (c.isPublic && !c.header.includes('extension')) || c.members.length);
  const structs = containers.filter((c) => c.isPublic && /\bstruct\b/.test(c.header));
  const main = structs.find((c) => normalise(c.name) === normalise(base)) ?? structs.find((c) => /:\s*.*\bView\b/.test(c.header)) ?? structs[0];
  const enums = enumDeclarations(src, '.swift');
  const api = [
    ...enums.map((e) => `public enum ${e.name} { case ${e.values.map(swiftCase).join(', ')} }`),
    ...shown.map((c) => {
      const members = c.members.map((m) => m.signature.split('\n').map((l) => `    ${l}`).join('\n'));
      return members.length ? `${c.header} {\n${members.join('\n\n')}\n}` : `${c.header} { }`;
    }),
  ].join('\n\n');
  const preview = /^#Preview\b[^\n{]*\{/m.exec(masked);
  const previewClose = preview ? closeOf(masked, preview.index + preview[0].length - 1) : -1;
  const init = main?.members.find((m) => m.kind.startsWith('init'));
  let example = null;
  if (previewClose !== -1) example = { code: dedent(src.slice(preview.index + preview[0].length, previewClose)), kind: 'preview', from: 'the `#Preview` block' };
  else if (init) example = { code: minimalSwiftCall(main.name, init.params, title), kind: 'minimal' };
  return {
    names: structs.filter((c) => /:\s*.*\bView(Modifier)?\b/.test(c.header)).map((c) => c.name),
    main: main?.name ?? null,
    doc: main ? docBefore(src, main.index, 'triple') : null,
    api: api || null,
    enums,
    example,
    signatures: shown.reduce((n, c) => n + c.members.length, 0),
  };
}

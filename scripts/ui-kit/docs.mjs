// Renders the parity matrix of docs/content/ui-kit.md from ui-kit.yaml and splices it between the
// marker comments. Used by check-ui-kit.mjs (`--write-docs` and the in-sync check).
import path from 'node:path';

export const DOC_PATH = 'docs/content/ui-kit.md';
export const START = '<!-- ui-kit:matrix:start (generated from ui-kit.yaml by `node scripts/check-ui-kit.mjs --write-docs`; do not edit) -->';
export const END = '<!-- ui-kit:matrix:end -->';

// Each row links to the component's page of the reference (scripts/ui-kit/component-docs.mjs).
const page = (name) => `[\`${name}\`](/ui-kit/components/${name})`;
const list = (values) => (values?.length ? values.map((v) => `\`${v}\``).join(', ') : '-');

function cell(entry) {
  if (!entry) return '?';
  if (entry.status === 'implemented') return `yes (\`${path.posix.basename(entry.file).replace(/\.\w+$/, '')}\`)`;
  if (entry.status === 'native') return `native (${entry.note})`;
  return entry.status;
}

/** `report`: { platform: { implemented, native, missing } } as computed by the checker. */
export function renderMatrix(doc, report) {
  const platforms = Object.keys(doc.platforms);
  const title = (p) => p[0].toUpperCase() + p.slice(1);
  const total = Object.keys(doc.components).length;
  const lines = [
    `| Platform | Implemented | Native | Missing | Of |`,
    `|---|---|---|---|---|`,
    ...platforms.map((p) => `| ${title(p)} | ${report[p].implemented} | ${report[p].native} | ${report[p].missing} | ${total} |`),
    '',
    `| Component | Variants | Sizes | ${platforms.map(title).join(' | ')} |`,
    `|---|---|---|${platforms.map(() => '---').join('|')}|`,
  ];
  for (const [name, c] of Object.entries(doc.components)) {
    if (c.alias) {
      lines.push(`| ${page(name)} | alias of \`${c.alias}\` | - | ${platforms.map(() => `see \`${c.alias}\``).join(' | ')} |`);
      continue;
    }
    lines.push(`| ${page(name)} | ${list(c.variants)} | ${list(c.sizes)} | ${platforms.map((p) => cell(c[p])).join(' | ')} |`);
  }
  lines.push('', '| Platform | Extensions (outside the canonical set) |', '|---|---|');
  for (const p of platforms) lines.push(`| ${title(p)} | ${list((doc.extensions?.[p] ?? []).map((f) => f.replace(/\.\w+$/, '')))} |`);
  const deviations = [];
  for (const [name, c] of Object.entries(doc.components)) {
    for (const [p, axes] of Object.entries(c.deviations ?? {})) {
      for (const [axis, d] of Object.entries(axes ?? {})) deviations.push(`| \`${name}\` | ${title(p)} | ${axis} | ${list(d.values)} | ${d.reason} |`);
    }
  }
  if (deviations.length) lines.push('', '| Component | Platform | Axis | Platform values | Reason for the deviation |', '|---|---|---|---|---|', ...deviations);
  return lines.join('\n');
}

/** The document with the generated block replaced, or null when the markers are missing. */
export function spliceMatrix(text, matrix) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start === -1 || end === -1 || end < start) return null;
  return `${text.slice(0, start + START.length)}\n\n${matrix}\n\n${text.slice(end)}`;
}

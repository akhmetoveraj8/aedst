// Small text helpers shared by the per-platform extractors of the component reference
// (scripts/ui-kit/component-docs.mjs). No parser dependency: the sources are masked (comments and
// string bodies blanked, same length) so that plain regular expressions and bracket counting are safe.

export const lf = (text) => text.replace(/\r\n/g, '\n');

/** `src` with comments and string bodies replaced by spaces; newlines and length are kept. */
export function mask(src) {
  const out = src.split('');
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const eol = src.indexOf('\n', i);
      const end = eol === -1 ? src.length : eol;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? src.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      // A quote that does not close on its line is text (an apostrophe in JSX), except a template literal.
      let j = i + 1;
      while (j < src.length && src[j] !== c && (c === '`' || src[j] !== '\n')) j += src[j] === '\\' ? 2 : 1;
      if (src[j] === c) {
        blank(i + 1, j);
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return out.join('');
}

/** Index of the bracket closing the one at `open` in masked text, or -1. */
export function closeOf(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if ('{[('.includes(masked[i])) depth++;
    else if ('}])'.includes(masked[i]) && --depth === 0) return i;
  }
  return -1;
}

/** `text` split at top-level commas (brackets and generic `<...>` respected; `->` and `=>` are not brackets). */
export function splitTop(text) {
  const masked = mask(text);
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if ('{[(<'.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    else if (c === '>' && !'-='.includes(masked[i - 1] ?? ' ')) depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Common indentation and surrounding blank lines removed; trailing spaces dropped. */
export function dedent(text) {
  const lines = lf(text).split('\n').map((l) => l.trimEnd());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  const indent = Math.min(...lines.filter(Boolean).map((l) => l.length - l.trimStart().length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
}

/**
 * Text of the doc comment that ends right above the declaration at `index`, first paragraph only,
 * as one line; null when there is none. `style`: `block` (a JSDoc / KDoc block; annotation and `//`
 * lines in between are skipped), `triple` (`///` in Swift) or `line` (`//` in Slint).
 */
export function docBefore(src, index, style = 'block') {
  const lines = src.slice(0, src.lastIndexOf('\n', index - 1) + 1).split('\n');
  lines.pop();
  const block = [];
  if (style === 'block') {
    while (lines.length && /^\s*(@|\/\/)/.test(lines.at(-1))) lines.pop();
    if (!/\*\/\s*$/.test(lines.at(-1) ?? '')) return null;
    while (lines.length) {
      const line = lines.pop();
      block.unshift(line);
      if (line.includes('/*')) break;
    }
  } else {
    while (lines.length && /^\s*@/.test(lines.at(-1))) lines.pop();
    const marker = style === 'triple' ? /^\s*\/\/\// : /^\s*\/\//;
    while (lines.length && marker.test(lines.at(-1))) block.unshift(lines.pop());
  }
  const paragraph = [];
  for (const raw of block) {
    const line = raw.replace(/^\s*(\/\*+|\/\/+|\*(?!\/))\s?/, '').replace(/\s*\*\/\s*$/, '').trim();
    if (/^(@\w+|- Parameters?\b|- Returns\b)/.test(line)) break;
    if (!line) { if (paragraph.length) break; continue; }
    paragraph.push(line);
  }
  return paragraph.join(' ').replace(/\s+/g, ' ').trim() || null;
}

/** First sentence of a doc comment, KDoc links (`[Name]`) unwrapped; the whole text when no sentence end is found. */
export function firstSentence(text) {
  if (!text) return null;
  const m = /^(.*?[.!?])(?=\s+[A-Z`[]|$)/s.exec(text);
  return (m ? m[1] : text).replace(/\[([\w.]+)\](?!\()/g, '$1').trim();
}

/** `alert-dialog` -> `AlertDialog`. */
export const pascal = (name) => name.split(/[-_]/).map((p) => p[0].toUpperCase() + p.slice(1)).join('');

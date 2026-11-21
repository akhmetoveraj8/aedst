// Reads the variant axes of `cva(...)` calls from TypeScript source without a parser dependency:
// a brace scanner that understands strings, template literals and comments. Used by check-ui-kit.mjs.

/** Index just past the string/template/comment that starts at `i`, or `i` when none starts there. */
function skipNonCode(src, i) {
  const c = src[i];
  if (c === '"' || c === "'" || c === '`') {
    let j = i + 1;
    while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  if (c === '/' && src[i + 1] === '/') {
    const end = src.indexOf('\n', i);
    return end === -1 ? src.length : end + 1;
  }
  if (c === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i);
    return end === -1 ? src.length : end + 2;
  }
  return i;
}

/** Index of the bracket that closes the one opened at `open`. */
function matchClose(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; ) {
    const next = skipNonCode(src, i);
    if (next !== i) { i = next; continue; }
    if ('{[('.includes(src[i])) depth++;
    else if ('}])'.includes(src[i]) && --depth === 0) return i;
    i++;
  }
  return -1;
}

/**
 * Top-level entries of the object literal opened at `open`: [{ key, valueStart }].
 * A key is an identifier or a quoted string directly followed by `:` at depth 1.
 */
export function objectEntries(src, open) {
  const close = matchClose(src, open);
  const entries = [];
  let expectKey = true;
  for (let i = open + 1; i < close; ) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && skipNonCode(src, i) !== i) { i = skipNonCode(src, i); continue; }
    if (expectKey) {
      const rest = src.slice(i, close);
      const m = /^(?:(["'])([^"']+)\1|([\w$-]+))\s*:/.exec(rest);
      if (m) {
        entries.push({ key: m[2] ?? m[3], valueStart: i + m[0].length });
        i += m[0].length;
        expectKey = false;
        continue;
      }
    }
    if ('{[('.includes(c)) { i = matchClose(src, i) + 1; continue; }
    const next = skipNonCode(src, i);
    if (next !== i) { i = next; continue; }
    if (c === ',') expectKey = true;
    i++;
  }
  return entries;
}

/**
 * Union of the variant axes of every `cva(` call in `src`: { variant: [..], size: [..], ... }.
 * Order follows first appearance in the source.
 */
export function cvaAxes(src) {
  const axes = {};
  for (const call of src.matchAll(/\bcva\s*\(/g)) {
    const end = matchClose(src, call.index + call[0].length - 1);
    const body = src.slice(call.index, end);
    // The config object is the last top-level `{` of the call that contains `variants:`.
    for (const m of body.matchAll(/\bvariants\s*:\s*\{/g)) {
      if (skipsInto(body, m.index)) continue;
      const open = call.index + m.index + m[0].length - 1;
      for (const axis of objectEntries(src, open)) {
        const valueOpen = src.indexOf('{', axis.valueStart);
        const names = objectEntries(src, valueOpen).map((e) => e.key);
        axes[axis.key] = [...new Set([...(axes[axis.key] ?? []), ...names])];
      }
    }
  }
  return axes;
}

/** True when `index` lies inside a string, template or comment of `src`. */
function skipsInto(src, index) {
  for (let i = 0; i < index; ) {
    const next = skipNonCode(src, i);
    if (next > index) return true;
    i = next === i ? i + 1 : next;
  }
  return false;
}

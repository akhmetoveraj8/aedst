// Parser for the ICU MessageFormat subset allowed in the shared translation files:
// text, `{name}` arguments and ONE `{name, plural, cat {...} ...}` per message with `#` as the count.
// Anything else (select, nested plurals, number/date styles) is rejected so that every platform can render it.
export const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** @returns {Array<{t:'text',v:string}|{t:'arg',name:string}|{t:'hash'}|{t:'plural',name:string,forms:Record<string,any[]>}>} */
export function parse(src, inPlural = false) {
  const segs = [];
  let buf = '';
  const flush = () => {
    if (buf) segs.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < src.length && depth) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      if (depth) throw new Error(`unbalanced "{" in: ${src}`);
      flush();
      segs.push(parseExpr(src.slice(i + 1, j - 1), src));
      i = j;
    } else if (c === '}') {
      throw new Error(`unbalanced "}" in: ${src}`);
    } else if (c === '#' && inPlural) {
      flush();
      segs.push({ t: 'hash' });
      i++;
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  return segs;
}

function parseExpr(inner, whole) {
  const arg = /^\s*([A-Za-z_]\w*)\s*$/.exec(inner);
  if (arg) return { t: 'arg', name: arg[1] };
  const pl = /^\s*([A-Za-z_]\w*)\s*,\s*plural\s*,([\s\S]*)$/.exec(inner);
  if (!pl) throw new Error(`unsupported ICU expression "{${inner.trim().slice(0, 30)}...}" in: ${whole}`);
  const forms = {};
  const re = /\s*(zero|one|two|few|many|other)\s*\{/y;
  let rest = pl[2];
  while (rest.trim()) {
    re.lastIndex = 0;
    const m = re.exec(rest);
    if (!m) throw new Error(`bad plural option near "${rest.trim().slice(0, 30)}" in: ${whole}`);
    let depth = 1;
    let j = m[0].length;
    while (j < rest.length && depth) {
      if (rest[j] === '{') depth++;
      else if (rest[j] === '}') depth--;
      j++;
    }
    if (depth) throw new Error(`unbalanced plural option in: ${whole}`);
    forms[m[1]] = parse(rest.slice(m[0].length, j - 1), true);
    rest = rest.slice(j);
  }
  if (!forms.other) throw new Error(`plural without "other" in: ${whole}`);
  return { t: 'plural', name: pl[1], forms };
}

/** Argument names in order of first appearance (the count of a plural counts as an argument). */
export function argNames(segs) {
  const out = [];
  const add = (n) => out.includes(n) || out.push(n);
  const walk = (list) => {
    for (const s of list) {
      if (s.t === 'arg') add(s.name);
      else if (s.t === 'plural') {
        add(s.name);
        for (const f of Object.values(s.forms)) walk(f);
      }
    }
  };
  walk(segs);
  return out;
}

/** The single plural of a message, or null. More than one is rejected. */
export function pluralOf(segs) {
  const ps = segs.filter((s) => s.t === 'plural');
  if (ps.length > 1) throw new Error('more than one plural in a message is not supported');
  return ps[0] ?? null;
}

/** Flatten a plural message into one plain segment list per category (prefix + option body + suffix). */
export function flatten(segs, category) {
  const out = [];
  for (const s of segs) {
    if (s.t !== 'plural') {
      out.push(s);
      continue;
    }
    const body = s.forms[category] ?? s.forms.other;
    for (const b of body) out.push(b.t === 'hash' ? { t: 'arg', name: s.name } : b);
  }
  return out;
}

// Reads Cargo manifests without cargo, for the static gates of apps/desktop and apps/gateway
// (check-feature-boundaries.mjs, check-approved-crates.mjs).
//
// Why a hand-written reader (Library-First exception): these gates must run on machines and CI jobs that
// have neither a Rust toolchain nor an `npm install` step, and Node ships no TOML parser. Only the subset
// Cargo manifests use is read: tables, array tables, dotted keys, strings, booleans, numbers, arrays and
// inline tables. Anything else throws, so an unreadable manifest fails the gate instead of passing it.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const BARE_KEY = /^[A-Za-z0-9_-]+/;

/** Parses one TOML value starting at `pos` in `src`; returns `[value, nextPos]`. */
function parseValue(src, pos) {
  pos = skipSpace(src, pos, true);
  const ch = src[pos];
  if (ch === '"' || ch === "'") {
    return parseString(src, pos);
  }
  if (ch === '[') {
    const items = [];
    pos = skipSpace(src, pos + 1, true);
    while (src[pos] !== ']') {
      const [item, next] = parseValue(src, pos);
      items.push(item);
      pos = skipSpace(src, next, true);
      if (src[pos] === ',') pos = skipSpace(src, pos + 1, true);
      else if (src[pos] !== ']') throw new Error(`expected , or ] at offset ${pos}`);
    }
    return [items, pos + 1];
  }
  if (ch === '{') {
    const table = {};
    pos = skipSpace(src, pos + 1, true);
    while (src[pos] !== '}') {
      const [keys, afterKey] = parseKey(src, pos);
      pos = skipSpace(src, afterKey, false);
      if (src[pos] !== '=') throw new Error(`expected = at offset ${pos}`);
      const [value, next] = parseValue(src, pos + 1);
      assign(table, keys, value);
      pos = skipSpace(src, next, true);
      if (src[pos] === ',') pos = skipSpace(src, pos + 1, true);
      else if (src[pos] !== '}') throw new Error(`expected , or } at offset ${pos}`);
    }
    return [table, pos + 1];
  }
  const word = /^[A-Za-z0-9_+.:-]+/.exec(src.slice(pos));
  if (!word) throw new Error(`unreadable value at offset ${pos}`);
  const text = word[0];
  const value = text === 'true' ? true : text === 'false' ? false : Number.isNaN(Number(text)) ? text : Number(text);
  return [value, pos + text.length];
}

function parseString(src, pos) {
  const quote = src[pos];
  if (src.startsWith(quote.repeat(3), pos)) throw new Error('multi-line strings are not supported');
  let out = '';
  for (let i = pos + 1; i < src.length; i += 1) {
    if (src[i] === '\\' && quote === '"') {
      out += src[i + 1];
      i += 1;
    } else if (src[i] === quote) {
      return [out, i + 1];
    } else {
      out += src[i];
    }
  }
  throw new Error(`unterminated string at offset ${pos}`);
}

/** Skips blanks and comments; newlines too when `newlines` is true (inside arrays and inline tables). */
function skipSpace(src, pos, newlines) {
  for (;;) {
    const ch = src[pos];
    if (ch === ' ' || ch === '\t' || ch === '\r' || (newlines && ch === '\n')) pos += 1;
    else if (ch === '#') while (pos < src.length && src[pos] !== '\n') pos += 1;
    else return pos;
  }
}

/** Parses a possibly dotted, possibly quoted key; returns `[segments, nextPos]`. */
function parseKey(src, pos) {
  const keys = [];
  for (;;) {
    pos = skipSpace(src, pos, false);
    if (src[pos] === '"' || src[pos] === "'") {
      const [key, next] = parseString(src, pos);
      keys.push(key);
      pos = next;
    } else {
      const bare = BARE_KEY.exec(src.slice(pos));
      if (!bare) throw new Error(`unreadable key at offset ${pos}`);
      keys.push(bare[0]);
      pos += bare[0].length;
    }
    pos = skipSpace(src, pos, false);
    if (src[pos] !== '.') return [keys, pos];
    pos += 1;
  }
}

function descend(table, keys) {
  let at = table;
  for (const key of keys) {
    if (at[key] === undefined) at[key] = {};
    at = Array.isArray(at[key]) ? at[key].at(-1) : at[key];
  }
  return at;
}

function assign(table, keys, value) {
  descend(table, keys.slice(0, -1))[keys.at(-1)] = value;
}

/** Parses the TOML subset described at the top of this file. */
export function parseToml(text) {
  const src = text.replace(/^\uFEFF/, '');
  const root = {};
  let current = root;
  let pos = 0;
  while (pos < src.length) {
    pos = skipSpace(src, pos, true);
    if (pos >= src.length) break;
    if (src[pos] === '[') {
      const isArray = src[pos + 1] === '[';
      const [keys, afterKey] = parseKey(src, pos + (isArray ? 2 : 1));
      pos = afterKey + (isArray ? 2 : 1);
      if (isArray) {
        const parent = descend(root, keys.slice(0, -1));
        const name = keys.at(-1);
        if (!Array.isArray(parent[name])) parent[name] = [];
        parent[name].push({});
        current = parent[name].at(-1);
      } else {
        current = descend(root, keys);
      }
      continue;
    }
    const [keys, afterKey] = parseKey(src, pos);
    pos = skipSpace(src, afterKey, false);
    if (src[pos] !== '=') throw new Error(`expected = after key ${keys.join('.')}`);
    const [value, next] = parseValue(src, pos + 1);
    assign(current, keys, value);
    pos = next;
  }
  return root;
}

export function readManifest(file) {
  try {
    return parseToml(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
}

const KINDS = { dependencies: 'normal', 'dev-dependencies': 'dev', 'build-dependencies': 'build' };

/**
 * Direct dependencies of a manifest, including `[target.<cfg>.*dependencies]`.
 * Each item: `{ name, kind: normal|dev|build, spec }` where `spec` is always a table
 * (`"1.2"` becomes `{ version: "1.2" }`).
 */
export function directDependencies(manifest) {
  const found = [];
  const collect = (table) => {
    for (const [section, kind] of Object.entries(KINDS)) {
      for (const [name, raw] of Object.entries(table?.[section] ?? {})) {
        found.push({ name, kind, spec: typeof raw === 'string' ? { version: raw } : raw });
      }
    }
  };
  collect(manifest);
  for (const target of Object.values(manifest.target ?? {})) collect(target);
  return found;
}

/** Files under `dir` (recursive) whose extension is in `extensions`; `target` folders are skipped. */
export function walk(dir, extensions) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'target') out.push(...walk(full, extensions));
    } else if (extensions.includes(path.extname(name))) {
      out.push(full);
    }
  }
  return out;
}

export function subdirectories(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => statSync(path.join(dir, name)).isDirectory()).sort();
}

/** Blanks out `//` and block comments (Rust and Slint), keeping line numbers. String contents stay. */
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'\\])\/\/.*$/gm, '$1');
}

/** `{ line, match }` for every match of the global regex `pattern` in `text`. */
export function matchesWithLines(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => ({
    line: text.slice(0, match.index).split('\n').length,
    match,
  }));
}

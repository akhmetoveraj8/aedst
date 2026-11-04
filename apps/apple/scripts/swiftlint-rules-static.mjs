#!/usr/bin/env node
// Static mirror of the `custom_rules` block in apps/apple/.swiftlint.yml, for machines without SwiftLint
// (Windows/Linux, pre-commit, `task check`). It PARSES the YAML block, so the rules cannot drift from the
// SwiftLint engine: same regex (multiline anchors), same `included` / `excluded` path regexes, comments never
// match (SwiftLint: excluded_match_kinds). Paths are matched as "/apps/apple/<path relative to apps/apple>".
//
// Usage (from anywhere):
//   node swiftlint-rules-static.mjs                     scan apps/apple/{Core,Features,App}
//   node swiftlint-rules-static.mjs --self-test         run fixtures: bad/ must trip every rule, good/ must be clean
//   node swiftlint-rules-static.mjs --root DIR --ext .swift.fixture   scan DIR as if it were apps/apple
// Exit 1 on any violation (or a failed self-test).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appleRoot = path.resolve(here, '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);

// ------------------------------------------------------------------ YAML (the machine-readable subset)
const unquote = (v) => {
  const t = v.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.startsWith('"') && t.endsWith('"')) return JSON.parse(t);
  return t;
};

export function parseRules(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^custom_rules:\s*$/.test(l));
  if (start < 0) throw new Error('.swiftlint.yml has no custom_rules block');
  const rules = [];
  let rule = null;
  let listKey = null;
  for (const raw of lines.slice(start + 1)) {
    if (/^\S/.test(raw) && !raw.startsWith('#')) break; // next top-level key
    if (/^\s*(#.*)?$/.test(raw)) continue;
    let m;
    if ((m = /^ {2}([a-z0-9_]+):\s*$/.exec(raw))) {
      rule = { id: m[1], regex: null, included: [], excluded: [], severity: 'warning' };
      rules.push(rule);
      listKey = null;
    } else if ((m = /^ {4}(included|excluded):\s*$/.exec(raw))) {
      listKey = m[1];
    } else if ((m = /^ {6}- (.+)$/.exec(raw)) && listKey) {
      rule[listKey].push(unquote(m[1]));
    } else if ((m = /^ {4}([a-z_]+):\s*(.+)$/.exec(raw))) {
      listKey = null;
      if (m[1] === 'regex') rule.regex = unquote(m[2]);
      if (m[1] === 'severity') rule.severity = m[2].trim();
    } else {
      throw new Error(`unparseable custom_rules line: ${raw}`);
    }
  }
  for (const r of rules) {
    if (!r.regex) throw new Error(`rule ${r.id} has no regex`);
    r.re = new RegExp(r.regex, 'gm');
    r.inc = r.included.map((p) => new RegExp(p));
    r.exc = r.excluded.map((p) => new RegExp(p));
  }
  return rules;
}

// ------------------------------------------------------------------ Swift comment mask
/** Boolean per char: true when the char is inside a // or block comment (strings are skipped correctly). */
function commentMask(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') mask[i++] = 1;
    } else if (c === '/' && n === '*') {
      let depth = 0;
      while (i < src.length) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; mask[i++] = 1; mask[i++] = 1; }
        else if (src[i] === '*' && src[i + 1] === '/') { depth--; mask[i++] = 1; mask[i++] = 1; if (depth === 0) break; }
        else mask[i++] = 1;
      }
    } else if (c === '"' && src.startsWith('"""', i)) {
      i += 3;
      while (i < src.length && !src.startsWith('"""', i)) i += src[i] === '\\' ? 2 : 1;
      i += 3;
    } else if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"' && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
      i++;
    } else {
      i++;
    }
  }
  return mask;
}

// ------------------------------------------------------------------ scanning
export function lintSource(rules, virtualPath, src) {
  const hits = [];
  const mask = commentMask(src);
  for (const r of rules) {
    if (!r.inc.some((re) => re.test(virtualPath))) continue;
    if (r.exc.some((re) => re.test(virtualPath))) continue;
    r.re.lastIndex = 0;
    for (let m; (m = r.re.exec(src)); ) {
      if (m[0] === '') { r.re.lastIndex++; continue; }
      if (mask[m.index]) continue;
      const line = src.slice(0, m.index).split('\n').length;
      hits.push({ rule: r.id, line, text: src.split('\n')[line - 1].trim().slice(0, 140) });
    }
  }
  return hits;
}

function* walk(dir, ext) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['.build', '.swiftpm', 'Generated', 'node_modules'].includes(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(f, ext);
    else if (f.endsWith(ext)) yield f;
  }
}

function scan(rules, root, ext, subdirs) {
  const out = [];
  for (const sub of subdirs) {
    const d = path.join(root, sub);
    if (!existsSync(d) || !statSync(d).isDirectory()) continue;
    for (const f of walk(d, ext)) {
      const rel = path.relative(root, f).split(path.sep).join('/');
      const virtualPath = `/apps/apple/${ext === '.swift' ? rel : rel.slice(0, -(ext.length - '.swift'.length))}`;
      const src = readFileSync(f, 'utf8');
      for (const h of lintSource(rules, virtualPath, src)) out.push({ ...h, file: rel, src });
    }
  }
  return out;
}

const rules = parseRules(readFileSync(path.join(appleRoot, '.swiftlint.yml'), 'utf8'));

if (argv.includes('--self-test')) {
  const fx = path.join(here, 'fixtures', 'swiftlint');
  const ext = '.swift.fixture';
  let ok = true;
  const bad = scan(rules, path.join(fx, 'bad'), ext, ['.']);
  const tripped = new Set(bad.map((h) => h.rule));
  for (const r of rules) {
    if (!tripped.has(r.id)) { ok = false; console.error(`SELF-TEST FAIL: no bad fixture trips rule ${r.id}`); }
  }
  // Every bad fixture file declares `// expect: rule_a rule_b`; each must be tripped in that file.
  for (const f of walk(path.join(fx, 'bad'), ext)) {
    const rel = path.relative(path.join(fx, 'bad'), f).split(path.sep).join('/');
    const expected = [...readFileSync(f, 'utf8').matchAll(/^\/\/ expect: (.+)$/gm)].flatMap((m) => m[1].trim().split(/\s+/));
    if (!expected.length) { ok = false; console.error(`SELF-TEST FAIL: ${rel} has no "// expect:" line`); }
    for (const id of expected) {
      if (!bad.some((h) => h.file === rel && h.rule === id)) { ok = false; console.error(`SELF-TEST FAIL: ${rel} did not trip ${id}`); }
    }
  }
  const good = scan(rules, path.join(fx, 'good'), ext, ['.']);
  for (const h of good) { ok = false; console.error(`SELF-TEST FAIL: good fixture ${h.file}:${h.line} tripped ${h.rule}: ${h.text}`); }
  console.log(ok
    ? `OK self-test: ${rules.length} rules, ${bad.length} violations in bad fixtures (all rules tripped), 0 in good fixtures.`
    : 'FAIL self-test');
  process.exit(ok ? 0 : 1);
}

const root = path.resolve(opt('--root', appleRoot));
const hits = scan(rules, root, opt('--ext', '.swift'), ['Core', 'Features', 'App']);
for (const h of hits) {
  const sev = rules.find((r) => r.id === h.rule).severity;
  console.error(`::${sev} file=apps/apple/${h.file},line=${h.line}::[${h.rule}] ${h.text}`);
}
console.log(hits.length
  ? `FAIL: ${hits.length} custom SwiftLint rule violation(s) (${rules.length} rules, static mirror of .swiftlint.yml).`
  : `OK: ${rules.length} custom SwiftLint rules (static mirror of .swiftlint.yml), no violations.`);
process.exit(hits.length ? 1 : 0);

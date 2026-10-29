// Text edits used by scripts/template-new.mjs. Every function takes the file text and returns
// { text, n } where n counts removed units (0 means nothing matched). Line-oriented on purpose:
// the files are YAML/TOML/Markdown with comments that a parse + re-serialise would destroy.
import path from 'node:path';

const eolOf = (t) => (t.includes('\r\n') ? '\r\n' : '\n');
const split = (t) => t.split(/\r?\n/);
const indentOf = (l) => l.length - l.trimStart().length;
const isBlank = (l) => l.trim() === '';
const isComment = (l) => l.trimStart().startsWith('#');

export function dropLines(text, pattern) {
  const re = new RegExp(pattern);
  const eol = eolOf(text);
  const lines = split(text);
  const kept = lines.filter((l) => !re.test(l));
  return { text: kept.join(eol), n: lines.length - kept.length };
}

/**
 * Remove whole blocks (a key line, the comment lines directly above it, and everything below it
 * that is indented deeper). `indent` is the key column; `key` matches the key text; `bodyMatch`
 * additionally removes a block whose body matches. `toml: true` blocks run to the next `[` or `#`.
 */
export function dropBlocks(text, { indent = 0, key, bodyMatch, toml = false }) {
  const keyRe = key ? new RegExp(key) : null;
  const bodyRe = bodyMatch ? new RegExp(bodyMatch) : null;
  const eol = eolOf(text);
  const lines = split(text);
  const drop = new Array(lines.length).fill(false);
  let n = 0;
  let floor = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const candidate = toml
      ? l.startsWith('[')
      : !isBlank(l) && !isComment(l) && !l.trimStart().startsWith('- ') && indentOf(l) === indent;
    if (!candidate || i < floor) continue;
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j];
      if (isBlank(b)) continue;
      if (toml ? b.startsWith('[') || b.startsWith('#') : indentOf(b) <= indent) break;
      end = j;
    }
    const name = toml ? l.trim() : l.trim().replace(/:(\s.*)?$/, '');
    const body = lines.slice(i, end + 1).join('\n');
    if (!((keyRe && keyRe.test(name)) || (bodyRe && bodyRe.test(body)))) {
      floor = end + 1;
      continue;
    }
    let start = i;
    while (start - 1 >= floor && isComment(lines[start - 1]) && (toml || indentOf(lines[start - 1]) <= indent)) start--;
    for (let k = start; k <= end; k++) drop[k] = true;
    // swallow one separating blank line so the seam does not leave a double blank
    if (end + 1 < lines.length && isBlank(lines[end + 1]) && (start === 0 || isBlank(lines[start - 1]))) drop[end + 1] = true;
    floor = end + 1;
    n++;
  }
  return { text: lines.filter((_, k) => !drop[k]).join(eol), n };
}

/** Remove Markdown sections whose heading matches (through the next heading of the same or higher level). */
export function dropMarkdownSections(text, heading) {
  const re = new RegExp(heading);
  const eol = eolOf(text);
  const lines = split(text);
  const out = [];
  let fence = false;
  let skipLevel = 0;
  let n = 0;
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+(.*)$/.exec(l);
    if (m) {
      if (skipLevel && m[1].length <= skipLevel) skipLevel = 0;
      if (!skipLevel && re.test(m[2])) { skipLevel = m[1].length; n++; continue; }
    }
    if (!skipLevel) out.push(l);
  }
  return { text: out.join(eol), n };
}

function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const c of s) {
    if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** features.yaml: drop the platform from `platforms`, `feature_roots`, feature rows and behaviours. */
export function featuresYaml(text, platform) {
  const eol = eolOf(text);
  const out = [];
  let section = '';
  let n = 0;
  let skipDeeper = -1;
  for (const l of split(text)) {
    const top = /^([A-Za-z_]+):/.exec(l);
    if (top) section = top[1];
    if (skipDeeper >= 0) {
      if (isBlank(l) || indentOf(l) > skipDeeper) continue;
      skipDeeper = -1;
    }
    if ((section === 'platforms' || section === 'feature_roots') && new RegExp(`^  ${platform}:`).test(l)) { n++; continue; }
    if (section === 'behaviors' && new RegExp(`^      ${platform}:`).test(l)) { n++; skipDeeper = 6; continue; }
    // A declared deviation of a removed platform would be reported as stale (it matches no check).
    if (section === 'exceptions' && new RegExp(String.raw`^\s*-\s*\{[^}]*\bplatform:\s*` + platform + String.raw`\b`).test(l)) { n++; continue; }
    const row = section === 'features' ? /^(\s+[\w-]+:\s*)\{(.*)\}\s*$/.exec(l) : null;
    if (row) {
      const pairs = splitTopLevel(row[2]);
      const kept = pairs.filter((p) => p.split(':')[0].trim() !== platform);
      if (kept.length !== pairs.length) { n++; out.push(`${row[1]}{ ${kept.join(', ')} }`); continue; }
    }
    out.push(l);
  }
  return { text: out.join(eol), n };
}

/** renovate.json: remove managers, package rules, per-manager config and custom managers of a platform. */
export function renovateJson(text, spec) {
  const eol = eolOf(text);
  const j = JSON.parse(text);
  let n = 0;
  const prefixes = spec.pathPrefixes;
  const underPrefix = (s) => prefixes.some((p) => s.startsWith(p) || s.startsWith(`/^${p}`) || s.startsWith(`/${p}`));
  const mentions = (s) => prefixes.some((p) => s.includes(p) || s.includes(p.replace(/\//g, '\\/'))) || spec.basenames.some((b) => s.includes(b));
  const ownPkg = (name) => spec.packageNames.some((p) => name.includes(p));
  if (Array.isArray(j.enabledManagers)) {
    const before = j.enabledManagers.length;
    j.enabledManagers = j.enabledManagers.filter((m) => !spec.managers.includes(m));
    n += before - j.enabledManagers.length;
  }
  if (Array.isArray(j.packageRules)) {
    const before = j.packageRules.length;
    j.packageRules = j.packageRules.filter((r) => {
      const files = r.matchFileNames ?? [];
      const mgrs = r.matchManagers ?? [];
      const pkgs = r.matchPackageNames ?? [];
      if (files.length && files.every(underPrefix)) return false;
      if (mgrs.length && mgrs.every((m) => spec.managers.includes(m)) && (!files.length || files.every(underPrefix))) return false;
      if (!files.length && !mgrs.length && pkgs.length && pkgs.every(ownPkg)) return false;
      return true;
    });
    n += before - j.packageRules.length;
  }
  for (const k of spec.topLevelKeys) if (k in j) { delete j[k]; n++; }
  if (Array.isArray(j.customManagers)) {
    const before = j.customManagers.length;
    j.customManagers = j.customManagers
      .map((cm) => {
        for (const field of ['managerFilePatterns', 'fileMatch']) {
          if (Array.isArray(cm[field])) cm[field] = cm[field].filter((s) => !mentions(s));
        }
        return cm;
      })
      .filter((cm) => (cm.managerFilePatterns ?? cm.fileMatch ?? [null]).length > 0);
    n += before - j.customManagers.length;
    if (j.customManagers.length === 0) delete j.customManagers;
  }
  return { text: `${JSON.stringify(j, null, 2)}${eol}`, n };
}

/** Remove `ext <e>` lines from scripts/file-size.config for extensions no remaining file uses. */
export function dropUnusedExt(text, exts, remainingFiles) {
  const used = new Set(remainingFiles.map((f) => path.extname(f).slice(1)));
  const dead = exts.filter((e) => !used.has(e));
  if (!dead.length) return { text, n: 0 };
  return dropLines(text, `^ext\\s+(${dead.join('|')})\\s*$`);
}

const LINK = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * Replace Markdown links whose target existed before the profile was applied and does not now with
 * their text. `before` and `after` are Sets of repo-relative file and directory paths.
 */
export function unlinkRemoved(text, file, before, after) {
  let n = 0;
  const dir = path.posix.dirname(file);
  const gone = (target) => {
    const t = decodeURI(target.split('#')[0].split('?')[0]);
    if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t)) return false;
    const bases = t.startsWith('/')
      ? [`docs/content${t}`, `docs${t}`, t.slice(1)]
      : [path.posix.normalize(path.posix.join(dir, t))];
    for (const b0 of bases) {
      const b = b0.replace(/\/$/, '');
      for (const v of ['', '.md', '.mdx', '/index.md', '/index.mdx', '/README.md']) {
        if (before.has(b + v) && !after.has(b + v)) return true;
      }
    }
    return false;
  };
  const out = text.replace(LINK, (whole, label, target) => {
    if (!gone(target)) return whole;
    n++;
    return label;
  });
  return { text: out, n };
}

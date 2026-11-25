// Pure scanning helpers of the dangerous-code gate (scripts/check-dangerous-code.mjs).
//
// Two passes over a file:
//   1. line pass: every rule over every non-comment line (comment lines only for `inComment` rules);
//   2. whole-text pass with comment lines blanked, so a call split across lines (`eval\n(x)`,
//      `exec.Command("sh",\n"-c", ...)`) is still seen. A hit is reported on the line where the match
//      starts.
// Waivers are bound to rule ids; a waiver that names no rule or gives no reason does not count.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { RULES } from './rules.mjs';

const TEST = /(^|\/)(e2e|__tests__|__mocks__|testdata|fixtures|androidTest|sharedTest|Tests?)\/|\.(test|spec|stories)\.[a-z]+$|Test\.kt$|Tests?\.swift$|_test\.go$/;
// Generated and vendored code is recognised by its PATH only. A marker such as "GENERATED" inside the
// text is never trusted: an agent could write it into any file.
const NON_SOURCE = /(^|\/)(node_modules|build|dist|\.next|target|Derived|\.build|generated|Generated|kotlin-gen|gen|docs|archive)\/|(^|\/)(scripts\/dangerous-code|\.claude)\/|^scripts\/check-dangerous-code\.mjs$|\.gen\.[a-z]+$|\.pb\.go$|_connect\.go$|\.sql\.go$|_pb\.[jt]s$/;
const COMMENT = /^\s*(?:\/\/|\/\*|\*|#|<!--)/;
// `security-ignore: rule-a,rule-b -- reason`. The reason must say why the line is safe.
const WAIVER = /security-ignore:\s*([a-z0-9-]+(?:\s*,\s*[a-z0-9-]+)*)\s+--\s+(\S.{9,})/;
// A Biome security suppression already names its rule and a reason; map it to the gate's rule ids.
const BIOME_WAIVER = /biome-ignore lint\/security\/(\w+):\s*(\S.{9,})/;
const BIOME_TO_RULES = {
  noDangerouslySetInnerHtml: ['react-dangerous-html'],
  noDangerouslySetInnerHtmlWithChildren: ['react-dangerous-html'],
  noGlobalEval: ['js-eval'],
};

// Files that make up the gate itself. Agents may not change them (pre-edit-guard.sh, --post-bash).
const PROTECTED = /^(\.claude\/settings\.json|\.claude\/hooks\/.+|apps\/server\/\.claude\/settings\.json|apps\/server\/\.claude\/hooks\/.+|scripts\/check-dangerous-code\.mjs|scripts\/dangerous-code\/.+|scripts\/dangerous-code\.allowlist|scripts\/test\/check-dangerous-code\.test\.mjs|scripts\/check-hooks\.sh|\.semgrep\/.+|lefthook\.yml)$/;

export const isProtectedGateFile = (file) => PROTECTED.test(file);

const globToRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

export function loadAllowlist(root) {
  const file = path.join(root, 'scripts/dangerous-code.allowlist');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.replace(/\s+#.*/, '').trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(globToRe);
}

export function isScannable(file, allow = []) {
  if (TEST.test(file) || NON_SOURCE.test(file)) return false;
  return !allow.some((a) => a.test(file));
}

/** Every waiver in a text: [{ line, ids, reason, text }]. */
export function findWaivers(text) {
  const out = [];
  String(text ?? '')
    .split('\n')
    .forEach((line, i) => {
      const own = WAIVER.exec(line);
      if (own) {
        out.push({ line: i + 1, ids: own[1].split(',').map((s) => s.trim()), reason: own[2].trim(), text: line.trim() });
        return;
      }
      const biome = BIOME_WAIVER.exec(line);
      if (biome) out.push({ line: i + 1, ids: BIOME_TO_RULES[biome[1]] ?? [], reason: biome[2].trim(), text: line.trim() });
    });
  return out;
}

/** Scan one file's text; returns [{ rule, line, text }]. Pure, shared by every entry point. */
export function scanText(file, text) {
  const ext = file.split('.').pop();
  const rules = RULES.filter((r) => r.exts.includes('*') || r.exts.includes(ext));
  const lines = String(text ?? '').split('\n');
  const waived = new Map(); // line index -> Set(rule ids)
  for (const w of findWaivers(text)) {
    for (const idx of [w.line - 1, w.line]) {
      const set = waived.get(idx) ?? new Set();
      for (const id of w.ids) set.add(id);
      waived.set(idx, set);
    }
  }
  const isWaived = (idx, id) => waived.get(idx)?.has(id) ?? false;
  const hits = [];
  const seen = new Set();
  const add = (rule, idx) => {
    const key = `${rule.id}:${idx}`;
    if (seen.has(key) || isWaived(idx, rule.id)) return;
    seen.add(key);
    hits.push({ rule, line: idx + 1, text: lines[idx].trim().slice(0, 120) });
  };

  // Pass 1: one line at a time.
  lines.forEach((line, i) => {
    const isComment = COMMENT.test(line);
    for (const rule of rules) {
      if (isComment && !rule.inComment) continue; // directives such as @ts-ignore live in comments
      if (rule.re.test(line)) add(rule, i);
    }
  });

  // Pass 2: the whole text with comment lines blanked (offsets kept). `\s*` in a rule now crosses line
  // breaks, so a call split across lines is still found, while `.` and `[^\n]` stay within one line.
  const body = lines.map((l) => (COMMENT.test(l) ? ' '.repeat(l.length) : l)).join('\n');
  const lineStarts = [0];
  for (let k = 0; k < body.length; k += 1) if (body[k] === '\n') lineStarts.push(k + 1);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  for (const rule of rules) {
    if (rule.inComment) continue;
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`);
    for (const m of body.matchAll(re)) {
      if (!m[0].includes('\n')) continue; // single-line matches were handled by pass 1
      const start = lineOf(m.index);
      const end = lineOf(m.index + m[0].length - 1);
      let waivedSpan = false;
      for (let k = start; k <= end; k += 1) if (isWaived(k, rule.id)) waivedSpan = true;
      if (!waivedSpan) add(rule, start);
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

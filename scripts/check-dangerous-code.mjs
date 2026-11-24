#!/usr/bin/env node
// Dangerous-code gate: refuses source patterns that are classic vulnerabilities (injection, XSS,
// broken TLS and crypto, hard-coded secrets, open CORS, ...). Rules: scripts/dangerous-code/rules.mjs.
//
// Three entry points, one rule set:
//   node scripts/check-dangerous-code.mjs            scan every tracked and new source file (task check)
//   node scripts/check-dangerous-code.mjs --staged   scan staged files only (pre-commit)
//   node scripts/check-dangerous-code.mjs --hook     PreToolUse hook: read the tool JSON on stdin and
//                                                    deny an Edit/Write whose new text matches a rule
//
// Waiver: `security-ignore: <reason>` on the same or the previous line (the reason is mandatory).
// Whole-file exceptions go to scripts/dangerous-code.allowlist (`glob  # reason`).
// Skipped: tests, fixtures, generated and vendored code, comment-only lines.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from './dangerous-code/rules.mjs';

const root = process.env.AEDST_DANGEROUS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST = /(^|\/)(e2e|__tests__|__mocks__|testdata|fixtures|androidTest|sharedTest|Tests?)\/|\.(test|spec|stories)\.[a-z]+$|Test\.kt$|Tests?\.swift$|_test\.go$/;
const NON_SOURCE = /(^|\/)(node_modules|build|dist|\.next|target|Derived|\.build|generated|Generated|kotlin-gen|gen|docs|archive)\/|(^|\/)(scripts\/dangerous-code|\.claude)\/|\.gen\.[a-z]+$/;
// A Biome security suppression already carries a reason after the colon, so it counts as a waiver.
const WAIVER = /security-ignore:\s*\S+|biome-ignore lint\/security\/\w+:\s*\S+/;
const COMMENT = /^\s*(?:\/\/|\/\*|\*|#|<!--)/;

const globToRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
const loadAllowlist = () => {
  const file = path.join(root, 'scripts/dangerous-code.allowlist');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.replace(/\s+#.*/, '').trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(globToRe);
};

export function isScannable(file, allow = []) {
  if (TEST.test(file) || NON_SOURCE.test(file)) return false;
  return !allow.some((a) => a.test(file));
}

/** Scan one file's text; returns [{ rule, line, text }]. Pure, shared by the repo scan and the hook. */
export function scanText(file, text) {
  if (/GENERATED/.test(text.slice(0, 400))) return [];
  const ext = file.split('.').pop();
  const rules = RULES.filter((r) => r.exts.includes('*') || r.exts.includes(ext));
  const lines = text.split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (WAIVER.test(line) || (i > 0 && WAIVER.test(lines[i - 1]))) return;
    const isComment = COMMENT.test(line);
    for (const rule of rules) {
      if (isComment && !rule.inComment) continue; // directives such as @ts-ignore live in comments
      if (rule.re.test(line)) hits.push({ rule, line: i + 1, text: line.trim().slice(0, 120) });
    }
  });
  return hits;
}

const format = (file, h) => `  ${file}:${h.line}  [${h.rule.id}] ${h.rule.why}\n      ${h.text}\n      fix: ${h.rule.fix}`;

function runHook() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return; // never crash a hook on empty input
  }
  const tool = input.tool_input ?? {};
  const file = String(tool.file_path ?? '').replace(/\\/g, '/');
  const rel = path.isAbsolute(file) || /^[A-Za-z]:\//.test(file) ? path.relative(root, file).replace(/\\/g, '/') : file;
  if (!rel || rel.startsWith('..') || !isScannable(rel, loadAllowlist())) return;
  const edits = Array.isArray(tool.edits) ? tool.edits.map((e) => e.new_string) : [tool.content, tool.new_string];
  const text = edits.filter((t) => typeof t === 'string').join('\n');
  const hits = scanText(rel, text);
  if (!hits.length) return;
  const reason = `Refusing to write insecure code to '${rel}' (docs/content/engineering/ai-safe-code.md):\n${hits.map((h) => format(rel, h)).join('\n')}\nUse the safe form. If this is a reviewed exception, add \`security-ignore: <reason>\` on the line (or the line above).`;
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`);
}

function runScan(staged) {
  const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files', '-co', '--exclude-standard'];
  const files = execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter(Boolean);
  const allow = loadAllowlist();
  let count = 0;
  for (const f of files) {
    const abs = path.join(root, f);
    if (!isScannable(f, allow) || !existsSync(abs)) continue;
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const hits = scanText(f, text);
    for (const h of hits) console.log(format(f, h));
    count += hits.length;
  }
  console.log(count ? `\nFAIL: ${count} dangerous pattern(s). Fix them, or add a justified waiver (see scripts/check-dangerous-code.mjs).` : 'OK: no dangerous code patterns');
  process.exit(count ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--hook')) runHook();
  else runScan(process.argv.includes('--staged'));
}

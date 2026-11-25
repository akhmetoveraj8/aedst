#!/usr/bin/env node
// Dangerous-code gate: refuses source patterns that are classic vulnerabilities (injection, XSS,
// broken TLS and crypto, hard-coded secrets, open CORS, ...). Rules: scripts/dangerous-code/rules.mjs.
// Library helpers (scanning, waivers): scripts/dangerous-code/scan.mjs.
//
// Entry points, one rule set:
//   node scripts/check-dangerous-code.mjs              scan every tracked and new source file (task check)
//   node scripts/check-dangerous-code.mjs --staged     scan the STAGED content of staged files (pre-commit)
//   node scripts/check-dangerous-code.mjs --files a b  scan whole files (PostToolUse after Edit/Write)
//   node scripts/check-dangerous-code.mjs --hook       PreToolUse hook: deny an Edit/Write whose new text
//                                                      matches a rule or adds a waiver
//   node scripts/check-dangerous-code.mjs --post-bash <marker>
//                                                      PostToolUse hook after Bash: scan every source file
//                                                      changed since <marker> was touched (closes the
//                                                      "write the file through the shell" bypass)
//   node scripts/check-dangerous-code.mjs --list-waivers  print every waiver (CI job summary)
//
// Waiver: `security-ignore: <rule-id>[,<rule-id>] -- <reason of 10+ chars>` on the same or the previous
// line. It silences only the named rules. Agents cannot add waivers: the hooks refuse a new one, a human
// reviewer adds it. Generated code is skipped by PATH only (never by a marker in the text).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findWaivers, isProtectedGateFile, isScannable, loadAllowlist, scanText } from './dangerous-code/scan.mjs';

export { findWaivers, isProtectedGateFile, isScannable, scanText };

const root = process.env.AEDST_DANGEROUS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
const format = (file, h) => `  ${file}:${h.line}  [${h.rule.id}] ${h.rule.why}\n      ${h.text}\n      fix: ${h.rule.fix}`;
const toRel = (file) => {
  const f = String(file ?? '').replace(/\\/g, '/');
  return path.isAbsolute(f) || /^[A-Za-z]:\//.test(f) ? path.relative(root, f).replace(/\\/g, '/') : f.replace(/^\.\//, '');
};
const readOr = (abs, fallback = '') => {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return fallback;
  }
};
const headText = (rel) => {
  try {
    return git(['show', `HEAD:${rel}`]);
  } catch {
    return '';
  }
};
const newWaivers = (before, after) => {
  const old = new Set(findWaivers(before).map((w) => w.text));
  return findWaivers(after).filter((w) => !old.has(w.text));
};

function readStdinJson() {
  try {
    const v = JSON.parse(readFileSync(0, 'utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function deny(reason) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`);
}

function runHook() {
  const tool = readStdinJson().tool_input ?? {};
  const rel = toRel(tool.file_path ?? tool.notebook_path);
  if (!rel || rel.startsWith('..') || !isScannable(rel, loadAllowlist(root))) return;
  const abs = path.join(root, rel);
  const edits = Array.isArray(tool.edits) ? tool.edits : [{ old_string: tool.old_string, new_string: tool.new_string ?? tool.content }];
  const after = edits.map((e) => e.new_string).filter((t) => typeof t === 'string').join('\n');
  const before = typeof tool.content === 'string' ? readOr(abs) : edits.map((e) => e.old_string).filter((t) => typeof t === 'string').join('\n');

  const added = newWaivers(before, after);
  if (added.length) {
    deny(`Refusing to add a security waiver to '${rel}':\n${added.map((w) => `  ${w.text}`).join('\n')}\nWaivers are added by a human reviewer, never by an agent. Use the safe form; if you believe the code is safe, stop and ask the user to review and add the waiver.`);
    return;
  }
  // Scan the edited text, and the whole resulting file when it can be computed, so a rule split
  // across two edits or across the edit boundary is still seen.
  let hits = scanText(rel, after);
  if (!hits.length && typeof tool.content !== 'string' && existsSync(abs)) {
    let whole = readOr(abs);
    for (const e of edits) if (typeof e.old_string === 'string' && typeof e.new_string === 'string') whole = whole.replace(e.old_string, () => e.new_string);
    hits = scanText(rel, whole);
  }
  if (!hits.length) return;
  deny(`Refusing to write insecure code to '${rel}' (docs/content/engineering/ai-safe-code.md):\n${hits.map((h) => format(rel, h)).join('\n')}\nUse the safe form. Do not rephrase the same pattern to get past the gate.`);
}

function scanFiles(files, read) {
  const allow = loadAllowlist(root);
  const out = [];
  for (const f of files) {
    if (!isScannable(f, allow)) continue;
    const text = read(f);
    if (text === null) continue;
    for (const h of scanText(f, text)) out.push(format(f, h));
  }
  return out;
}

function runScan(mode, files) {
  let list = files;
  let read = (f) => (existsSync(path.join(root, f)) ? readOr(path.join(root, f), null) : null);
  if (mode === 'staged') {
    list = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']).split('\n').filter(Boolean);
    read = (f) => {
      try {
        return git(['show', `:${f}`]);
      } catch {
        return null;
      }
    };
  } else if (mode === 'all') {
    list = git(['ls-files', '-co', '--exclude-standard']).split('\n').filter(Boolean);
  }
  const findings = scanFiles(list.map(toRel), read);
  for (const line of findings) console.log(line);
  console.log(findings.length ? `\nFAIL: ${findings.length} dangerous pattern(s). Fix them (see docs/content/engineering/ai-safe-code.md).` : 'OK: no dangerous code patterns');
  process.exit(findings.length ? 1 : 0);
}

// PostToolUse(Bash): the marker file was touched by pre-bash-guard.sh right before the command ran.
function runPostBash(marker) {
  if (!marker || !existsSync(marker)) return;
  const since = statSync(marker).mtimeMs - 1000; // coarse filesystem clocks
  const changed = git(['ls-files', '-mo', '--exclude-standard'])
    .split('\n')
    .filter(Boolean)
    .filter((f) => {
      try {
        return statSync(path.join(root, f)).mtimeMs >= since;
      } catch {
        return false;
      }
    });
  const problems = [];
  const allow = loadAllowlist(root);
  for (const f of changed) {
    if (isProtectedGateFile(f)) {
      problems.push(`  ${f}: security gate file changed through the shell. Gate files are human-maintained; revert your change and ask the user.`);
      continue;
    }
    if (!isScannable(f, allow)) continue;
    const text = readOr(path.join(root, f));
    for (const w of newWaivers(headText(f), text)) problems.push(`  ${f}:${w.line}: new security waiver added through the shell. Remove it; only a human reviewer adds waivers.`);
    for (const h of scanText(f, text)) problems.push(format(f, h));
  }
  if (!problems.length) return;
  const reason = `The last shell command wrote insecure code or weakened the security gate (docs/content/engineering/ai-safe-code.md):\n${problems.join('\n')}\nFix it now with the Edit tool and the safe form.`;
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`);
}

function runListWaivers() {
  const allow = loadAllowlist(root);
  const files = git(['ls-files']).split('\n').filter(Boolean);
  let n = 0;
  for (const f of files) {
    if (!isScannable(f, allow)) continue;
    for (const w of findWaivers(readOr(path.join(root, f)))) {
      console.log(`- \`${f}:${w.line}\` ${w.ids.join(', ')}: ${w.reason}`);
      n += 1;
    }
  }
  console.log(`\n${n} security waiver(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const at = (flag) => argv.indexOf(flag);
  if (argv.includes('--hook')) runHook();
  else if (at('--post-bash') >= 0) runPostBash(argv[at('--post-bash') + 1]);
  else if (argv.includes('--list-waivers')) runListWaivers();
  else if (at('--files') >= 0) runScan('files', argv.slice(at('--files') + 1));
  else runScan(argv.includes('--staged') ? 'staged' : 'all', []);
}

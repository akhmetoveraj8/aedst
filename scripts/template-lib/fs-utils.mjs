// File-system helpers for scripts/template-new.mjs (Node built-ins only).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FALLBACK_SKIP = new Set([
  '.git', 'node_modules', '.next', 'build', '.gradle', '.build', 'vcpkg_installed', 'Pods', 'DerivedData', '.idea', 'worktrees',
]);

// Local tool output that is untracked-but-not-ignored in some checkouts; never part of a template.
const JUNK = /(^|\/)(\.vitest|test-results|playwright-report|\.claude\/worktrees)\//;

/** Repo-relative POSIX paths of every source file (tracked + untracked, not ignored). */
export function listSourceFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files = out.split('\0').filter(Boolean);
    if (files.length > 0) return files.filter((f) => fs.existsSync(path.join(root, f)) && !JUNK.test(f));
  } catch {
    // not a git checkout: fall through to a directory walk
  }
  return walk(root, '');
}

/** Every file under `root` (or `root/rel`), skipping dependency and build directories. */
export function walk(root, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (FALLBACK_SKIP.has(e.name) || JUNK.test(`${e.name}/`)) continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(root, p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

export function copyTree(srcRoot, dstRoot, files) {
  for (const f of files) {
    const dst = path.join(dstRoot, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(srcRoot, f), dst);
  }
}

/** Glob to RegExp. `**` crosses '/', `*` does not, `?` is one non-slash char. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const matchesAny = (file, regexps) => regexps.some((r) => r.test(file));

export function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function readText(root, rel) {
  const buf = fs.readFileSync(path.join(root, rel));
  return isBinary(buf) ? null : buf.toString('utf8');
}

export function writeText(root, rel, text) {
  fs.writeFileSync(path.join(root, rel), text);
}

export function removePath(root, rel) {
  fs.rmSync(path.join(root, rel), { recursive: true, force: true });
}

/** Remove empty directories under root/rel (bottom-up). */
export function pruneEmptyDirs(root, rel = '') {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== '.git') pruneEmptyDirs(root, rel ? `${rel}/${e.name}` : e.name);
  }
  if (rel && fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
}

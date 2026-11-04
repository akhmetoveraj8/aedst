// External-identifier renames for scripts/template-new.mjs. Only identifiers a customer or an app
// store sees are renamed. The internal codename (proto packages `aedst.*`, the Go import path,
// `Aedst*` types, the QML URI, the AEDST_ env prefix) is deliberately untouched; see
// docs/content/decisions/cross-cutting.md.
import fs from 'node:fs';
import path from 'node:path';
import { globToRegExp, matchesAny, readText, writeText } from './fs-utils.mjs';

export function deriveNames({ name, org, domain }) {
  const display = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z][A-Za-z0-9 -]{0,38}$/.test(display)) {
    throw new Error(`--name must start with a letter and contain only letters, digits, spaces and hyphens (max 39 chars): "${display}"`);
  }
  const slug = display.toLowerCase().replace(/ /g, '-').replace(/-+/g, '-').replace(/-$/, '');
  const id = slug.replace(/-/g, '');
  const snake = slug.replace(/-/g, '_');
  const orgName = org ?? slug;
  const domainBase = domain ?? `${id}`;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(orgName)) throw new Error(`--org must be a GitHub-style lowercase name: "${orgName}"`);
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(domainBase)) throw new Error(`--domain must be a lowercase DNS label base: "${domainBase}"`);
  if (display.toLowerCase() === 'aedst') throw new Error('--name must differ from the template codename');
  return { display, slug, id, snake, org: orgName, domainBase };
}

/** Ordered rename rules: [{ id, re, to }]. `to` is a function so `$` in names is never special. */
export function buildRules(n) {
  const fn = (s) => () => s;
  return [
    { id: 'registry-org', re: /ghcr\.io\/aedst\//g, to: fn(`ghcr.io/${n.org}/`) },
    { id: 'bundle-prefix', re: /com\.aedst\.(apple|Desktop)\b/g, to: (_, p) => `com.${n.id}.${p}` },
    { id: 'android-application-id', re: /(applicationId\s*=\s*")com\.aedst\./g, to: (_, p) => `${p}com.${n.id}.` },
    { id: 'android-google-services', re: /("package_name":\s*")com\.aedst\./g, to: (_, p) => `${p}com.${n.id}.` },
    { id: 'android-quoted-app-id', re: /(?<!namespace\s*=\s*)"com\.aedst\.android(\.tv)?"/g, to: (_, tv) => `"com.${n.id}.android${tv ?? ''}"` },
    { id: 'chart-image-names', re: /\baedst-(server|desktop)\b/g, to: (_, p) => `${n.slug}-${p}` },
    { id: 'domains', re: /(?<!com\.)(?<!\w)aedst\.(dev|com|app|example)\b/g, to: (_, tld) => `${n.domainBase}.${tld}` },
    { id: 'cookie-name', re: /\baedst_session/g, to: fn(`${n.snake}_session`) },
    { id: 'display-name', re: /(?<!\w)AEDST(?!\w)/g, to: fn(n.display) },
  ];
}

export const applyRules = (text, rules) => rules.reduce((t, r) => t.replace(r.re, r.to), text);

/** Globs never renamed: generated output (from scripts/file-size.config), history, locks, protos, the tool. */
export function renameSkipMatchers(root) {
  const globs = [
    'docs/archive/**', 'CHANGELOG.md', '**/*.proto', '**/*.lock', '**/pnpm-lock.yaml', '**/go.sum', '**/Package.resolved',
    '**/package-lock.json', 'scripts/template-new.mjs', 'scripts/template-profiles.json', 'scripts/template-lib/**',
    'scripts/test/template-new.test.mjs', '**/gradle/wrapper/**',
  ];
  const bash = [];
  const cfg = path.join(root, 'scripts', 'file-size.config');
  if (fs.existsSync(cfg)) {
    for (const line of fs.readFileSync(cfg, 'utf8').split(/\r?\n/)) {
      const m = /^exclude\s+(\S+)/.exec(line);
      // file-size.config globs are bash-style: `*` crosses '/'.
      if (m) bash.push(new RegExp(`^${m[1].replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')}$`));
    }
  }
  return [...globs.map(globToRegExp), ...bash];
}

/** Rename content in every text file, then rename paths. Returns counts. */
export function renameExternal(root, files, names) {
  const rules = buildRules(names);
  const skip = renameSkipMatchers(root);
  let edited = 0;
  let moved = 0;
  const finalFiles = [];
  for (const f of files) {
    if (matchesAny(f, skip) || !fs.existsSync(path.join(root, f))) { finalFiles.push(f); continue; }
    const text = readText(root, f);
    if (text !== null) {
      const next = applyRules(text, rules);
      if (next !== text) { writeText(root, f, next); edited++; }
    }
    const nextPath = applyRules(f, rules);
    if (nextPath !== f) {
      fs.mkdirSync(path.dirname(path.join(root, nextPath)), { recursive: true });
      fs.renameSync(path.join(root, f), path.join(root, nextPath));
      moved++;
      finalFiles.push(nextPath);
    } else finalFiles.push(f);
  }
  return { edited, moved, files: finalFiles };
}

// Shape checks for features.yaml: every feature has the same layers, locale catalog, tests and navigation entry on
// every platform, and the cross-platform declarations (flagged set, outbox types, i18n namespace, routes, plugin id)
// agree with the code. Pure functions over a repository root so scripts/test can run them on a temp tree.
// Docs: docs/content/decisions/cross-cutting.md, docs/content/parity.md.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WEB_LOCALES = ['en', 'ru', 'tj', 'uz', 'ar'];
const NATIVE_LOCALES = ['en', 'ru', 'tg', 'uz', 'ar'];
const ANDROID_RES = ['values', 'values-en', 'values-tg', 'values-uz', 'values-ar'];

const pascal = (id) => id.charAt(0).toUpperCase() + id.slice(1);
const list = (v) => (Array.isArray(v) ? v : []);

/** All regular files under `dir` (relative paths, forward slashes), skipping build output. */
export function walk(root, dir) {
  const out = [];
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === 'build' || name === 'node_modules' || name === '.build') continue;
    const rel = `${dir}/${name}`;
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...walk(root, rel));
    else out.push(rel);
  }
  return out;
}

const read = (root, rel) => readFileSync(path.join(root, rel), 'utf8');
const has = (root, rel) => existsSync(path.join(root, rel));
const hasDir = (root, rel) => has(root, rel) && statSync(path.join(root, rel)).isDirectory();

/** Per platform: the checks (id -> function returning a problem string or null) for one feature directory. */
function platformChecks(root, platform, featureId, dir) {
  const id = featureId;
  const files = () => walk(root, dir);
  const layers = (base) => Object.fromEntries(['data', 'domain', 'presentation'].map((l) => [
    l,
    () => (hasDir(root, `${base}/${l}`) || hasDir(root, `${base}/${pascal(l)}`) ? null : `missing layer directory ${base}/${l}`),
  ]));
  const locales = (names, make) => () => {
    const miss = names.filter((n) => !has(root, make(n)));
    return miss.length ? `missing locale catalog(s): ${miss.map(make).join(', ')}` : null;
  };
  switch (platform) {
    case 'web': {
      const base = dir;
      return {
        manifest: () => (has(root, `${base}/manifest.ts`) && read(root, `${base}/manifest.ts`).includes(`id: "${id}"`) ? null : `${base}/manifest.ts missing or its id is not "${id}"`),
        public: () => (has(root, `${base}/public.ts`) ? null : `missing ${base}/public.ts`),
        ui: () => (hasDir(root, `${base}/ui`) ? null : `missing ${base}/ui`),
        lib: () => (hasDir(root, `${base}/lib`) ? null : `missing ${base}/lib`),
        i18n: locales(WEB_LOCALES, (l) => `${base}/i18n/${l}.json`),
        tests: () => (files().some((f) => /\.test\.[cm]?[jt]sx?$/.test(f)) ? null : `no co-located *.test.* file under ${base}`),
        navigation: () => (has(root, `${base}/manifest.ts`) && /routes:\s*\[/.test(read(root, `${base}/manifest.ts`)) ? null : `${base}/manifest.ts declares no routes`),
      };
    }
    case 'android': {
      const main = `${dir}/src/main/kotlin/com/aedst/feature/${id}`;
      return {
        ...layers(main),
        navigation: () => (has(root, `${main}/navigation/${pascal(id)}NavGraph.kt`) ? null : `missing ${main}/navigation/${pascal(id)}NavGraph.kt`),
        i18n: locales(ANDROID_RES, (r) => `${dir}/src/main/res/${r}/strings.xml`),
        tests: () => (files().some((f) => f.startsWith(`${dir}/src/test/`) && f.endsWith('.kt')) ? null : `no unit test under ${dir}/src/test`),
      };
    }
    case 'apple': {
      const src = `${dir}/Sources/${path.basename(dir)}`;
      return {
        package: () => (has(root, `${dir}/Package.swift`) ? null : `missing ${dir}/Package.swift`),
        ...layers(src),
        navigation: () => (has(root, `${src}/Navigation/${pascal(id)}Destinations.swift`) ? null : `missing ${src}/Navigation/${pascal(id)}Destinations.swift`),
        i18n: () => {
          const cat = `${src}/Resources/Localizable.xcstrings`;
          if (!has(root, cat)) return `missing ${cat}`;
          const used = new Set();
          for (const entry of Object.values(JSON.parse(read(root, cat)).strings ?? {}))
            for (const l of Object.keys(entry.localizations ?? {})) used.add(l);
          const miss = NATIVE_LOCALES.filter((l) => !used.has(l));
          return miss.length ? `${cat} has no ${miss.join(', ')} localization` : null;
        },
        tests: () => (files().some((f) => f.startsWith(`${dir}/Tests/`) && f.endsWith('.swift')) ? null : `no Swift test under ${dir}/Tests`),
      };
    }
    case 'desktop': {
      // apps/desktop-rs/crates/<crate>: src/{data,domain,presentation}, ui/<id>.slint, i18n/<locale>/LC_MESSAGES/*.po, tests/*.rs
      const src = `${dir}/src`;
      return {
        ...layers(src),
        navigation: () => (files().some((f) => f.startsWith(`${dir}/ui/`) && f.endsWith('.slint')) ? null : `no .slint file under ${dir}/ui`),
        i18n: () => {
          const miss = NATIVE_LOCALES.filter((l) => !files().some((f) => f.startsWith(`${dir}/i18n/${l}/LC_MESSAGES/`) && f.endsWith('.po')));
          return miss.length ? `missing locale catalog(s) under ${dir}/i18n: ${miss.join(', ')}` : null;
        },
        tests: () => (files().some((f) => f.startsWith(`${dir}/tests/`) && f.endsWith('.rs')) ? null : `no *.rs integration test under ${dir}/tests`),
      };
    }
    default:
      return {};
  }
}

/** Quoted outbox item types ("task.create") in the outbox-related source files of one feature directory. */
export function outboxTypesIn(root, platform, dir, featureId) {
  const found = new Set();
  if (platform === 'web') {
    const m = /outbox:\s*\[([^\]]*)\]/.exec(has(root, `${dir}/manifest.ts`) ? read(root, `${dir}/manifest.ts`) : '');
    for (const s of (m?.[1] ?? '').matchAll(/"([^"]+)"/g)) found.add(s[1]);
    return found;
  }
  for (const f of walk(root, dir)) {
    if (!/outbox/i.test(path.basename(f)) || /test/i.test(f)) continue;
    for (const s of read(root, f).matchAll(new RegExp(`"(${featureId.replace(/s$/, '')}s?\\.[a-z_]+)"`, 'g'))) found.add(s[1]);
  }
  return found;
}

function stringConstants(text) {
  const map = {};
  for (const m of text.matchAll(/(?:const val|static let)\s+(\w+)\s*(?::\s*\w+\s*)?=\s*"([^"]+)"/g)) map[m[1]] = m[2];
  return map;
}

/** Feature roots of a platform (web has one per project: app and admin). */
const rootsOf = (doc, p) => [].concat(doc.feature_roots[p]);
/** The directory that holds feature `name` on platform `p` (the first root that has it). */
const featureDir = (root, doc, p, name) => rootsOf(doc, p).map((r) => `${r}/${name}`).find((d) => hasDir(root, d)) ?? `${rootsOf(doc, p)[0]}/${name}`;

/** The feature ids a client build declares, and its flagged subset, read from the platform's own code. */
export function clientBuildOf(root, platform) {
  const out = { features: null, flagged: null };
  if (platform === 'web') {
    // The web client is several projects (app, admin): the union of their modules is the web build.
    const dirs = ['apps/web/app/src/modules', 'apps/web/admin/src/modules'].filter((d) => hasDir(root, d));
    const mods = dirs.flatMap((dir) => readdirSync(path.join(root, dir)).filter((n) => has(root, `${dir}/${n}/manifest.ts`)).map((n) => ({ n, file: `${dir}/${n}/manifest.ts` })));
    out.features = new Set(mods.map((m) => m.n));
    out.flagged = new Set(mods.filter((m) => /flagged:\s*true/.test(read(root, m.file))).map((m) => m.n));
  } else if (platform === 'android') {
    const consts = stringConstants(read(root, 'apps/android/core/common/src/main/kotlin/com/aedst/core/common/CapabilitiesState.kt'));
    const text = read(root, 'apps/android/core/capabilities/src/main/kotlin/com/aedst/core/capabilities/CapabilitiesModule.kt');
    const set = (key) => new Set([...(new RegExp(`${key}\\s*=\\s*setOf\\(([^)]*)\\)`).exec(text)?.[1] ?? '').matchAll(/AedstFeature\.(\w+)/g)].map((m) => consts[m[1]] ?? m[1]));
    out.features = set('features');
    out.flagged = set('flagged');
  } else if (platform === 'apple') {
    const text = read(root, 'apps/apple/App/Shared/Sources/AedstAppShared/AppDependencies+Capabilities.swift');
    const consts = stringConstants(text);
    const set = (key) => new Set([...(new RegExp(`${key}:\\s*Set<String>\\s*=\\s*\\[([^\\]]*)\\]`).exec(text)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((n) => consts[n] ?? n)]);
    out.features = set('built');
    out.flagged = set('flagged');
  } else if (platform === 'desktop') {
    // desktop-rs declares the built and flagged sets in client_build(); read the same literals the code uses.
    const f = 'apps/desktop-rs/crates/aedst-desktop/src/services.rs';
    const text = has(root, f) ? read(root, f) : '';
    const set = (key) => new Set([...(new RegExp(`${key}:\\s*set\\(&\\[([^\\]]*)\\]`).exec(text)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    out.features = set('features');
    out.flagged = set('flagged');
  }
  return out;
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const show = (s) => `[${[...s].sort().join(', ')}]`;

/**
 * Returns { errors, used } where `used` are the exception keys that matched a real deviation (stale exceptions
 * are reported by the caller).
 */
export function checkShape(root, doc, knownOutboxTypes) {
  const errors = [];
  const used = new Set();
  const platforms = Object.keys(doc.platforms).filter((p) => p !== 'server');
  const exceptions = list(doc.exceptions);
  const skipped = (feature, platform, check) => {
    const ex = exceptions.find((e) => e.feature === feature && e.platform === platform && list(e.skip).includes(check));
    if (ex) used.add(`${feature}/${platform}/${check}`);
    return Boolean(ex);
  };

  for (const e of exceptions) {
    if (!e.feature || !e.platform || !e.reason || !list(e.skip).length) errors.push(`exceptions: each entry needs feature, platform, skip[] and reason (${JSON.stringify(e)})`);
  }

  const declaredOutbox = new Set();
  for (const [feature, f] of Object.entries(doc.features)) {
    for (const key of ['flagged', 'outbox', 'i18n_namespace', 'routes'])
      if (f[key] === undefined) errors.push(`feature ${feature}: missing declaration \`${key}\``);
    for (const t of list(f.outbox)) declaredOutbox.add(t);

    for (const p of platforms) {
      if (!f[p]) continue; // `~` = not started on this platform (frozen desktop-rs)
      const dir = featureDir(root, doc, p, f[p]);
      if (!hasDir(root, dir)) continue; // reported by the directory check
      for (const [check, fn] of Object.entries(platformChecks(root, p, feature, dir))) {
        const problem = fn();
        if (problem && !skipped(feature, p, check)) errors.push(`${feature} on ${p}: ${check}: ${problem}`);
        if (!problem && skipped(feature, p, check)) errors.push(`${feature} on ${p}: exception for ${check} is stale (the check passes now); remove it`);
      }
      const declared = new Set(list(f.outbox));
      const actual = outboxTypesIn(root, p, dir, feature);
      const ok = sameSet(declared, actual);
      if (!ok && !skipped(feature, p, 'outbox')) errors.push(`${feature} on ${p}: outbox types in code ${show(actual)} != declared ${show(declared)}`);
      if (ok && skipped(feature, p, 'outbox')) errors.push(`${feature} on ${p}: exception for outbox is stale; remove it`);
    }

    if (f.i18n_namespace && has(root, `${featureDir(root, doc, 'web', f.web)}/manifest.ts`)) {
      const manifest = read(root, `${featureDir(root, doc, 'web', f.web)}/manifest.ts`);
      const ns = /i18nNamespaces:\s*\[([^\]]*)\]/.exec(manifest)?.[1] ?? '';
      if (!ns.includes(`"${f.i18n_namespace}"`)) errors.push(`feature ${feature}: web manifest i18nNamespaces ${ns.trim()} does not list "${f.i18n_namespace}"`);
      // The namespace is typed in the web message catalogue type (src/app/config/i18n/messages.d.ts).
      const types = `${featureDir(root, doc, 'web', f.web).replace(/\/modules\/[^/]+$/, '')}/app/config/i18n/messages.d.ts`;
      if (has(root, types) && !read(root, types).includes(`/modules/${f.web}/i18n/en.json`)) errors.push(`feature ${feature}: ${types} does not import the module catalogue`);
    }
    if (has(root, `${featureDir(root, doc, 'web', f.web)}/manifest.ts`)) {
      const manifest = read(root, `${featureDir(root, doc, 'web', f.web)}/manifest.ts`);
      const block = /routes:\s*\[([\s\S]*?)\n  \],?\n|routes:\s*\[([^\]]*)\]/.exec(manifest);
      const paths = [...(block?.[1] ?? block?.[2] ?? '').matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);
      if (!sameSet(new Set(paths), new Set(list(f.routes)))) errors.push(`feature ${feature}: web manifest routes ${show(new Set(paths))} != declared routes ${show(new Set(list(f.routes)))}`);
    }
  }

  for (const e of exceptions)
    for (const check of list(e.skip))
      if (!used.has(`${e.feature}/${e.platform}/${check}`)) errors.push(`exceptions: ${e.feature}/${e.platform}/${check} matches no check`);

  if (knownOutboxTypes && !sameSet(declaredOutbox, new Set(knownOutboxTypes)))
    errors.push(`outbox types declared across features ${show(declaredOutbox)} != knownTypes of docs/contract/behavior/offline-outbox.json ${show(new Set(knownOutboxTypes))}`);

  // Same ids and the same flagged set on every client.
  const ids = new Set(Object.keys(doc.features));
  const flagged = new Set(Object.entries(doc.features).filter(([, f]) => f.flagged === true).map(([n]) => n));
  for (const p of platforms) {
    let build;
    try { build = clientBuildOf(root, p); } catch (err) { errors.push(`${p}: cannot read the client build declaration: ${err.message}`); continue; }
    if (!sameSet(build.features, ids)) errors.push(`${p}: client build features ${show(build.features)} != features.yaml ${show(ids)}`);
    if (!sameSet(build.flagged, flagged)) errors.push(`${p}: flagged set ${show(build.flagged)} != features.yaml flagged ${show(flagged)} (docs/content/decisions/cross-cutting.md)`);
  }
  return { errors, used };
}

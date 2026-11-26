// Generates the platform catalogs from the shared translation files and validates them.
//   node build.mjs           validate, then write apps/web/shared/i18n/catalogs (committed) and generated/ (git-ignored)
//   node build.mjs --check   validate only, and fail when a committed Web catalogue differs from its source
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { androidFile, androidPath, appleFile, applePath, poFile, poPath, webPath } from './lib/emit.mjs';
import { ANDROID_HOMES, APPLE_HOMES, DESKTOP_HOMES, pickNested, platformsOf } from './lib/targets.mjs';
import { LOCALES, listModules, loadModule, root } from './lib/load.mjs';

const checkOnly = process.argv.includes('--check');
const writeAndroid = process.argv.includes('--write-android');
const writeApple = process.argv.includes('--write-apple');
const writeDesktop = process.argv.includes('--write-desktop');
const modules = listModules();
const errors = modules.length ? [] : ['no modules found under packages/i18n'];
const loaded = modules.map((m) => [m, loadModule(m)]);
for (const [, r] of loaded) errors.push(...r.errors);

const normalise = (text) => `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
const targetsOf = Object.fromEntries(loaded.map(([m, r]) => [m, r.targets]));
const has = (mod, key, platform) => platformsOf(targetsOf[mod], key).includes(platform);
const webText = (mod, l) =>
  `${JSON.stringify(pickNested(JSON.parse(readFileSync(path.join(root, mod, `${l}.json`), 'utf8')), (k) => has(mod, k, 'web')), null, 2)}
`;
if (!errors.length) {
  for (const mod of modules) {
    if (!Object.values(targetsOf[mod]).some((ps) => ps.includes('web')) && Object.keys(targetsOf[mod]).length) continue;
    for (const l of LOCALES) {
      const file = path.join(root, webPath(mod, l));
      const stale = !existsSync(file) || readFileSync(file, 'utf8') !== webText(mod, l);
      if (stale && checkOnly) errors.push(`${path.relative(root, file)} is stale; run: node packages/i18n/build.mjs`);
      else if (stale) {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, webText(mod, l));
      }
    }
  }
}

if (errors.length) {
  console.error(`i18n: ${errors.length} problem(s)\n${errors.map((e) => `  ${e}`).join('\n')}`);
  process.exit(1);
}

const forPlatform = (mod, byLocale, platform) =>
  Object.fromEntries(Object.entries(byLocale).map(([l, keys]) => [l, Object.fromEntries(Object.entries(keys).filter(([k]) => has(mod, k, platform)))]));
const appleLocal = (mod) => {
  const f = path.join(root, mod, 'apple-local.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};
const desktopLocal = (mod) => {
  const f = path.join(root, mod, 'desktop-local.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};
const CRATE_OF = Object.fromEntries(Object.entries(DESKTOP_HOMES).map(([crate, m]) => [m, crate]));
const DESKTOP_PO = (mod, l) => path.join(root, '..', '..', 'apps/desktop/crates', CRATE_OF[mod], 'i18n', l, 'LC_MESSAGES', `${CRATE_OF[mod]}.po`);
const APPLE_CATALOG = (mod) => path.join(root, '..', '..', 'apps/apple', APPLE_HOMES[mod].file);
const ANDROID_RES = (home, l) => path.join(root, '..', '..', 'apps/android', home.home, 'src/main/res', { en: 'values', ru: 'values-ru', tg: 'values-tg', uz: 'values-uz', ar: 'values-ar' }[l], 'strings.xml');

if (!checkOnly) {
  const write = (rel, text) => {
    const file = path.join(root, 'generated', rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  for (const [mod, { byLocale, enOrder }] of loaded) {
    const android = forPlatform(mod, byLocale, 'android');
    const apple = forPlatform(mod, byLocale, 'apple');
    const desktop = forPlatform(mod, byLocale, 'desktop');
    for (const l of LOCALES) {
      write(androidPath(mod, l), androidFile(mod, android[l], enOrder));
      write(poPath(mod, l), poFile(mod, l, desktop, enOrder, desktopLocal(mod) ?? {}));
      if (writeDesktop && CRATE_OF[mod] && desktopLocal(mod)) writeFileSync(DESKTOP_PO(mod, l), poFile(mod, l, desktop, enOrder, desktopLocal(mod)));
      if (writeAndroid && ANDROID_HOMES[mod]) {
        const file = ANDROID_RES(ANDROID_HOMES[mod], l);
        writeFileSync(file, androidFile(mod, android[l], enOrder));
      }
    }
    write(applePath(mod), appleFile(mod, apple, enOrder, appleLocal(mod) ?? {}));
    if (writeApple && APPLE_HOMES[mod] && appleLocal(mod)) writeFileSync(APPLE_CATALOG(mod), appleFile(mod, apple, enOrder, appleLocal(mod)));
  }
} else {
  // A committed Android catalogue that carries the GENERATED header must match its source.
  for (const [mod, { byLocale, enOrder }] of loaded.filter(([m]) => ANDROID_HOMES[m])) {
    const android = forPlatform(mod, byLocale, 'android');
    for (const l of LOCALES) {
      const file = ANDROID_RES(ANDROID_HOMES[mod], l);
      const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
      if (text.includes('GENERATED from packages/i18n') && text !== androidFile(mod, android[l], enOrder)) {
        errors.push(`${path.relative(path.join(root, '..', '..'), file)} is stale; run: node packages/i18n/build.mjs --write-android`);
      }
    }
  }
  // A module with apple-local.json is migrated: its String Catalog must equal the generated one.
  for (const [mod, { byLocale, enOrder }] of loaded.filter(([m]) => APPLE_HOMES[m] && appleLocal(m))) {
    const file = APPLE_CATALOG(mod);
    const want = appleFile(mod, forPlatform(mod, byLocale, 'apple'), enOrder, appleLocal(mod));
    if (!existsSync(file) || readFileSync(file, 'utf8') !== want) errors.push(`${path.relative(path.join(root, '..', '..'), file)} is stale; run: node packages/i18n/build.mjs --write-apple`);
  }
  // A module with desktop-local.json is migrated: its .po catalogues must equal the generated ones.
  for (const [mod, { byLocale, enOrder }] of loaded.filter(([m]) => CRATE_OF[m] && desktopLocal(m))) {
    const desktop = forPlatform(mod, byLocale, 'desktop');
    for (const l of LOCALES) {
      const file = DESKTOP_PO(mod, l);
      if (!existsSync(file) || readFileSync(file, 'utf8') !== poFile(mod, l, desktop, enOrder, desktopLocal(mod))) {
        errors.push(`${path.relative(path.join(root, '..', '..'), file)} is stale; run: node packages/i18n/build.mjs --write-desktop`);
      }
    }
  }
  if (errors.length) {
    console.error(`i18n: ${errors.length} problem(s)\n${errors.map((e) => `  ${e}`).join('\n')}`);
    process.exit(1);
  }
}
console.log(`i18n: ${modules.length} modules x ${LOCALES.length} locales OK${checkOnly ? '' : ' (generated)'}`);

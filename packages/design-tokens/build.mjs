// Style Dictionary v5 build for the AEDST design tokens.
//
// Source of truth: ./tokens/**/*.json (DTCG format, `usesDtcg: true`).
// Outputs are written into each platform's design-system directory and are committed.
// Only pieces with no Style Dictionary built-in are custom: the name transforms (AEDST
// naming per CONVENTIONS.md), the web CSS file layout (one file, :root + .dark), the
// Slint globals format and a whitespace normaliser around the built-in Kotlin/Swift formats.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import StyleDictionary from 'style-dictionary';
import { formattedVariables } from 'style-dictionary/utils';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const out = (...p) => path.relative(here, path.join(repo, ...p)).split(path.sep).join('/') + '/';

const OUT = {
  web: out('apps/web/shared/ui'),
  android: out('apps/android/core/ui/src/main/kotlin/com/aedst/core/ui/theme'),
  apple: out('apps/apple/Core/AedstDesignSystem/Sources/AedstDesignSystem'),
  desktopRs: out('apps/desktop/crates/aedst-ui/ui'),
};

const HEADER = 'GENERATED — do not edit; edit packages/design-tokens/tokens';
const DARK_PREFIX = 'dark--';
const KOTLIN_PACKAGE = 'com.aedst.core.ui.theme';

// ---------------------------------------------------------------- helpers
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const camel = (parts) => parts.map((p, i) => (i === 0 ? p : cap(p))).join('');
const kebab = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase();
const isColor = (t) => t.path[0] === 'color';
const mode = (m) => (t) => isColor(t) && t.path[1] === m;
const group = (g) => (t) => t.path[0] === g;
/** Collapse runs of blank lines, trim trailing whitespace, end with exactly one newline. */
const normalise = (s) =>
  s
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n*$/, '\n');

// ------------------------------------------------------------ custom hooks
StyleDictionary.registerFileHeader({ name: 'aedst/generated', fileHeader: () => [HEADER] });

// Member name inside a per-group type: color.light.background -> background, spacing.xs -> xs,
// typography.bodyMedium.fontSize -> bodyMediumFontSize.
StyleDictionary.registerTransform({
  name: 'aedst/name/member',
  type: 'name',
  transform: (t) => camel(t.path.slice(isColor(t) ? 2 : 1)),
});
// Slint global member: light/dark palettes share one file, so keep the mode.
// color.light.background -> lightBackground, spacing.xs -> spacingXs.
StyleDictionary.registerTransform({
  name: 'aedst/name/slint',
  type: 'name',
  transform: (t) => camel(t.path.slice(isColor(t) ? 1 : 0)),
});
// CSS custom property: shadcn names for colors (--primary-foreground), `--aedst-*` for the
// rest, `$extensions["com.aedst"].cssName` overrides (radius.lg -> --radius, shadcn's base).
StyleDictionary.registerTransform({
  name: 'aedst/name/css',
  type: 'name',
  transform: (t) => {
    const override = t.$extensions?.['com.aedst']?.cssName;
    if (override) return override;
    if (!isColor(t)) return `aedst-${kebab(camel(t.path))}`;
    // Dark tokens get a temporary prefix (stripped in aedst/css) so light/dark names don't collide.
    return `${t.path[1] === 'dark' ? DARK_PREFIX : ''}${kebab(camel(t.path.slice(2)))}`;
  },
});
// Apple durations are TimeInterval seconds; tokens are milliseconds.
StyleDictionary.registerTransform({
  name: 'aedst/time/seconds-number',
  type: 'value',
  filter: (t, o) => (o.usesDtcg ? t.$type : t.type) === 'time',
  transform: (t, _c, o) => String(parseFloat(o.usesDtcg ? t.$value : t.value) / 1000),
});

// Web: one CSS file. Light palette + scales on :root, dark palette on .dark.
StyleDictionary.registerFormat({
  name: 'aedst/css',
  format: async ({ dictionary, file, options }) => {
    const { usesDtcg } = options;
    const block = (selector, tokens) =>
      `${selector} {\n${formattedVariables({
        format: 'css',
        dictionary: { ...dictionary, allTokens: tokens, tokens: {} },
        usesDtcg,
      })}\n}\n`;
    const all = dictionary.allTokens;
    const light = all.filter(mode('light'));
    const dark = all.filter(mode('dark')).map((t) => ({ ...t, name: t.name.slice(DARK_PREFIX.length) }));
    // Breakpoints are a desktop-window concept (the web uses CSS media queries): not emitted into tokens.css.
    const scales = all.filter((t) => !isColor(t) && t.path[0] !== 'breakpoint');
    // Trim trailing zeros (0.1450 -> 0.145, 0.00 -> 0) so the file is stable under Biome's CSS formatter.
    const trimZeros = (s) =>
      s.replace(/(\d+)\.(\d*?)0+(?=[\s)\/;a-z])/g, (_m, i, f) => (f ? `${i}.${f}` : i));
    return normalise(
      trimZeros(
        `/**\n * ${HEADER}\n */\n\n${block(':root', [...light, ...scales])}\n${block('.dark', dark)}`,
      ),
    );
  },
});

// Kotlin / Swift: built-in formats, output normalised for ktlint / SwiftLint (blank lines, EOF).
const builtIn = (name) => StyleDictionary.hooks.formats[name];
for (const [name, base, post] of [
  [
    'aedst/compose',
    'compose/object',
    // ktlint: 4-space indent. detekt MayBeConst + ktlint property-naming: integer tokens
    // become `const val SCREAMING_SNAKE` (CONVENTIONS.md: Kotlin constants).
    (s) =>
      s
        .replace(/^( +)/gm, (m) => m + m)
        .replace(
          /^( +)val (\w+) = (\d+)$/gm,
          (_m, ind, name, n) => `${ind}const val ${name.replace(/([A-Z])/g, '_$1').toUpperCase()} = ${n}`,
        ),
  ],
  ['aedst/swift', 'ios-swift/any.swift', (s) => s],
]) {
  StyleDictionary.registerFormat({
    name,
    format: async (args) => post(normalise(await builtIn(base)(args))),
  });
}

// Desktop (Rust + Slint): one global `AedstTokens` with a `dark` switch. Colors pick the mode
// themselves (`dark ? dark-value : light-value`), so a component only reads `AedstTokens.background`.
// Dimensions and font sizes are px lengths, times are ms durations, weights and other numbers plain.
StyleDictionary.registerFormat({
  name: 'aedst/slint-globals',
  format: async ({ dictionary }) => {
    const all = dictionary.allTokens;
    const dim = (t) => {
      const v = t.original.$value;
      return `${v.value}${v.unit === 'ms' ? 'ms' : 'px'}`;
    };
    const scalar = (t) => {
      const v = t.original.$value;
      const raw = typeof v === 'object' ? v.value : v;
      if (t.$type === 'time' || t.original.$value?.unit === 'ms') return ['duration', `${raw}ms`];
      if (t.$type === 'dimension' || t.$type === 'fontSize') return ['length', dim(t)];
      if (t.$type === 'fontWeight') return ['int', String(raw)];
      return [Number.isInteger(+raw) ? 'int' : 'float', String(raw)];
    };
    const lines = [];
    const lightByName = new Map(all.filter(mode('light')).map((t) => [t.path.slice(2).join('.'), t]));
    for (const dark of all.filter(mode('dark'))) {
      const key = dark.path.slice(2).join('.');
      const light = lightByName.get(key);
      lines.push(
        `    out property <color> ${kebab(camel(dark.path.slice(2)))}: root.dark ? ${dark.$value} : ${light.$value};`,
      );
    }
    for (const t of all.filter((x) => !isColor(x))) {
      const [type, value] = scalar(t);
      lines.push(`    out property <${type}> ${kebab(camel(t.path))}: ${value};`);
    }
    const body = ['    in-out property <bool> dark: false;', ...lines].join('\n');
    return normalise(`// ${HEADER}\n\nexport global AedstTokens {\n${body}\n}\n`);
  },
});

// ------------------------------------------------------------------ build
const KOTLIN_TRANSFORMS = [
  'aedst/name/member',
  'color/composeColor',
  'size/compose/dp',
  'size/compose/sp',
];
const kotlin = (className, filter, imports) => ({
  destination: `${className}.kt`,
  format: 'aedst/compose',
  filter,
  options: {
    fileHeader: 'aedst/generated',
    packageName: KOTLIN_PACKAGE,
    className,
    import: imports,
  },
});
const COLOR_IMPORT = ['androidx.compose.ui.graphics.Color'];
const DP_IMPORT = ['androidx.compose.ui.unit.dp'];
const TEXT_IMPORT = ['androidx.compose.ui.unit.dp', 'androidx.compose.ui.unit.sp'];

const swift = (className, filter, imports = ['SwiftUI']) => ({
  destination: `${className}.swift`,
  format: 'aedst/swift',
  filter,
  options: {
    fileHeader: 'aedst/generated',
    className,
    objectType: 'enum',
    accessControl: 'public',
    import: imports,
  },
});

// task template:new --profile core|mobile deletes whole apps; skip the targets whose app directory is gone.
const APP_ROOT = { android: 'apps/android', apple: 'apps/apple', desktopRs: 'apps/desktop' };
const existing = (all) =>
  Object.fromEntries(Object.entries(all).filter(([name]) => !APP_ROOT[name] || existsSync(path.join(repo, APP_ROOT[name]))));

const sd = new StyleDictionary({
  usesDtcg: true,
  source: ['tokens/**/*.json'],
  log: { verbosity: 'default', warnings: 'error' },
  platforms: existing({
    web: {
      buildPath: OUT.web,
      transforms: [
        'attribute/cti',
        'aedst/name/css',
        'time/seconds',
        'size/rem',
        'color/oklch',
      ],
      files: [{ destination: 'tokens.css', format: 'aedst/css', options: { fileHeader: 'aedst/generated' } }],
    },
    android: {
      buildPath: OUT.android,
      transforms: KOTLIN_TRANSFORMS,
      files: [
        kotlin('AedstLightPalette', mode('light'), COLOR_IMPORT),
        kotlin('AedstDarkPalette', mode('dark'), COLOR_IMPORT),
        kotlin('AedstSpacing', group('spacing'), DP_IMPORT),
        kotlin('AedstRadius', group('radius'), DP_IMPORT),
        kotlin('AedstElevation', group('elevation'), DP_IMPORT),
        kotlin('AedstTypeScale', group('typography'), TEXT_IMPORT),
        kotlin('AedstMotion', group('motion'), []),
      ],
    },
    apple: {
      buildPath: OUT.apple,
      basePxFontSize: 1, // Style Dictionary's rem->CGFloat transform multiplies by this; tokens are already px/pt.
      transforms: [
        'aedst/name/member',
        'color/ColorSwiftUI',
        'size/swift/remToCGFloat',
        'aedst/time/seconds-number',
      ],
      files: [
        swift('AedstLightPalette', mode('light')),
        swift('AedstDarkPalette', mode('dark')),
        swift('AedstSpacing', group('spacing')),
        swift('AedstRadius', group('radius')),
        swift('AedstElevation', group('elevation')),
        swift('AedstTypeScale', group('typography')),
        swift('AedstMotion', group('motion'), ['Foundation']),
      ],
    },
    desktopRs: {
      buildPath: OUT.desktopRs,
      transforms: ['aedst/name/slint', 'color/hex'],
      files: [{ destination: 'aedst_tokens.slint', format: 'aedst/slint-globals' }],
    },
  }),
});

// Light and dark must define exactly the same token names.
await sd.hasInitialized;
const keys = (m) =>
  Object.keys(sd.tokens.color[m])
    .filter((k) => !k.startsWith('$'))
    .sort();
const [light, dark] = [keys('light'), keys('dark')];
if (JSON.stringify(light) !== JSON.stringify(dark)) {
  const diff = light.filter((k) => !dark.includes(k)).concat(dark.filter((k) => !light.includes(k)));
  throw new Error(`color/light.json and color/dark.json differ in tokens: ${diff.join(', ')}`);
}

const checking = process.argv.includes('--check');
const generated = Object.values(sd.options.platforms).flatMap((p) =>
  p.files.map((f) => path.join(here, p.buildPath, f.destination)),
);
const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);
const before = checking ? generated.map(read) : [];

await sd.buildAllPlatforms();

// `--check`: fail when regenerating changed (or created) any output, i.e. tokens and generated
// files have drifted apart. Compares content before/after the build, so a dirty git tree does not matter.
if (checking) {
  const drifted = generated.filter((file, i) => read(file) !== before[i]).map((f) => path.relative(here, f));
  if (drifted.length > 0) {
    console.error(`Design tokens are out of sync with generated files. Run "pnpm build" and commit:\n${drifted.join('\n')}`);
    process.exit(1);
  }
  console.log('Generated design-token outputs are up to date.');
}

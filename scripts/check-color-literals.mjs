#!/usr/bin/env node
// Repo-level colour-literal ban. Colours come from packages/design-tokens (generated into each
// platform's design system); hand-written UI code must reference tokens, never literals:
//   web      hex, rgb()/rgba()/hsl()/hsla()/oklch()/oklab()/hwb()/lab()/lch(), and Tailwind palette
//            classes (bg-red-500, text-neutral-600, ...) outside apps/web/shared/ui: use the
//            token utilities (bg-destructive, text-muted-foreground, Badge variants success/warning/info)
//   android  Color(0x..), Color(<number>), Color.Red/White/..., parseColor("#..."), #hex in res XML
//   apple    Color(red:/white:/hue:), UIColor(/NSColor( with components, #colorLiteral, Color(hex:
//   desktop  hex and rgb()/hsl()/oklch() literals in .slint and .rs files
//   server   hex / rgb() in templates and CSS (email/OG output)
// Skipped automatically: generated files (header contains `GENERATED`), comment-only lines, test
// files and fixtures. Everything else must be listed in scripts/color-literals.allowlist.
//
// Usage: node scripts/check-color-literals.mjs [--json] [--staged]
// Exit 1 on any offender.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// AEDST_COLOR_ROOT points the scan at another tree (apps/web `pnpm check:selftest`).
const root = process.env.AEDST_COLOR_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = new Set(process.argv.slice(2));

const gitArgs = argv.has('--staged') ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files', '-co', '--exclude-standard'];
const all = execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter(Boolean);

const platformOf = (f) => /^apps\/(server|web|android|apple|desktop)\//.exec(f)?.[1] ?? null;
const HEX = '(?<![\\w&/#$])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\\w-])';
const FN = '\\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\\(';
// Tailwind default-palette utilities: a literal colour in disguise (no theme, no dark mode).
const PALETTE =
  '\\b(?:bg|text|border|ring|from|via|to|fill|stroke|outline|divide|decoration|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b';
const WEB_PALETTE_EXEMPT = /^apps\/web\/shared\/ui\//; // shadcn primitives, reviewed with the kit
const RULES = {
  web: { exts: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'css'], res: [HEX, FN, PALETTE] },
  android: {
    exts: ['kt', 'xml'],
    res: [
      '\\bColor\\(\\s*(?:0x|\\d)',
      '\\bColor\\.(?:Black|White|Red|Green|Blue|Yellow|Cyan|Magenta|Gray|LightGray|DarkGray)\\b',
      'parseColor\\(',
      '\\bandroid:color\\s*=\\s*"#|>\\s*#[0-9a-fA-F]{3,8}\\s*<|"#[0-9a-fA-F]{3,8}"',
    ],
  },
  apple: {
    exts: ['swift'],
    res: [
      '\\bColor\\(\\s*(?:red|white|hue|hex|\\.sRGB|\\.displayP3)',
      '\\b(?:UIColor|NSColor)\\(\\s*(?:red|white|hue|displayP3Red|srgbRed)',
      '#colorLiteral\\(',
      '\\bColor\\(\\s*uiColor:\\s*UIColor\\(',
    ],
  },
  'desktop': { exts: ['slint', 'rs'], res: [HEX, FN] },
  server: { exts: ['html', 'tmpl', 'gohtml', 'css', 'txt', 'mjml'], res: [HEX, FN] },
};
for (const r of Object.values(RULES)) r.res = r.res.map((s) => new RegExp(s));
const PALETTE_RE = new RegExp(PALETTE);

const TEST = /(^|\/)(e2e|__tests__|__mocks__|testdata|fixtures|androidTest|sharedTest|Tests?)\/|\.(test|spec|stories)\.[a-z]+$|Test\.kt$|Tests?\.swift$|_test\.(go|cpp)$/;
const NON_SOURCE = /(^|\/)(node_modules|build|dist|\.next|target|Derived|\.build|generated|Generated|kotlin-gen|gen)\//;

const aFile = 'scripts/color-literals.allowlist';
const re = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
const allow = existsSync(path.join(root, aFile))
  ? readFileSync(path.join(root, aFile), 'utf8')
      .split('\n')
      .map((l) => l.replace(/\s+#.*/, '').trim())
      .filter((l) => l && !l.startsWith('#'))
      .map(re)
  : [];

const offenders = [];
for (const f of all) {
  const platform = platformOf(f);
  if (!platform) continue;
  const rule = RULES[platform];
  const ext = f.split('.').pop();
  if (!rule.exts.includes(ext) || TEST.test(f) || NON_SOURCE.test(f)) continue;
  if (allow.some((a) => a.test(f))) continue;
  if (platform === 'web' && f.startsWith('apps/web/shared/ui/tokens.css')) continue;
  if (platform === 'android' && ext === 'xml' && !/\/res\//.test(f)) continue;
  const abs = path.join(root, f);
  if (!existsSync(abs)) continue;
  const text = readFileSync(abs, 'utf8');
  if (/GENERATED/.test(text.slice(0, 400))) continue;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || (ext === 'xml' && t.startsWith('<!--'))) return;
    const skipPalette = platform === 'web' && WEB_PALETTE_EXEMPT.test(f);
    if (rule.res.some((r) => !(skipPalette && r.source === PALETTE_RE.source) && r.test(line))) offenders.push({ platform, file: f, line: i + 1, text: t.slice(0, 120) });
  });
}

if (argv.has('--json')) {
  console.log(JSON.stringify(offenders, null, 2));
} else {
  const byPlatform = Map.groupBy(offenders, (o) => o.platform);
  for (const [p, items] of byPlatform) {
    const files = new Set(items.map((i) => i.file));
    console.log(`\n== ${p}: ${items.length} literal(s) in ${files.size} file(s)`);
    for (const i of items.slice(0, 40)) console.log(`  ${i.file}:${i.line}  ${i.text}`);
    if (items.length > 40) console.log(`  ... ${items.length - 40} more (use --json)`);
  }
}
const gating = offenders;
if (!argv.has('--json')) console.log(gating.length ? `\nFAIL: ${gating.length} colour literal(s). Use design tokens (packages/design-tokens) or add a justified line to ${aFile}.` : '\nOK: no gating colour literals');
process.exit(gating.length ? 1 : 0);

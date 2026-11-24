#!/usr/bin/env node
// UI-kit-only gate. Feature code must build screens from the UI kit (ui-kit.yaml), never from raw
// platform controls, and must never recreate a kit component by hand:
//   web      raw <button> <input> <select> <textarea> <label> <form> <table> <dialog> <progress> <hr>
//            <details> <kbd> ..., and direct imports of the primitive libraries behind the kit
//            (radix-ui, @base-ui/react, cmdk, input-otp, react-day-picker, ...) outside apps/web/shared/ui
//   android  Material 3 controls (Button, TextField, Card, Switch, AlertDialog, ...) outside core/ui
//   apple    SwiftUI controls (Button, TextField, Toggle, Picker, ...) and .sheet/.alert modifiers
//            outside Core/AedstDesignSystem
//   desktop  std-widgets.slint imports outside crates/aedst-ui
// Layout primitives (div, Box, VStack, Rectangle), plain text and icons are not kit components.
// A missing kit component is added to the kit first (ui-kit.yaml, then web, then the other platforms).
//
// Exemption: put `ui-kit-ignore: <reason>` in a comment on the offending line or the line above.
// Existing debt (native platforms) is a ratchet in scripts/ui-kit-only.baseline: a file may not
// exceed its recorded count, and a file that is not listed has a budget of 0. Web has no baseline.
//
// Usage: node scripts/check-ui-kit-only.mjs [--json] [--staged] [--write-baseline]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.AEDST_UIKIT_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = new Set(process.argv.slice(2));
const gitArgs = argv.has('--staged') ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files', '-co', '--exclude-standard'];
const files = execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter(Boolean);

const WEB_ELEMENTS = {
  button: 'Button (ui/button)',
  input: 'Input, Checkbox, Switch, RadioGroup, InputOTP (ui/*)',
  select: 'Select or NativeSelect (ui/select, ui/native-select)',
  textarea: 'Textarea (ui/textarea)',
  label: 'Label or FieldLabel (ui/label, ui/field)',
  form: 'Form (ui/form)',
  fieldset: 'Field (ui/field)',
  legend: 'Field (ui/field)',
  table: 'Table or DataTable (ui/table, ui/data-table)',
  dialog: 'Dialog, AlertDialog, Sheet or Drawer (ui/*)',
  progress: 'Progress (ui/progress)',
  meter: 'Progress (ui/progress)',
  hr: 'Separator (ui/separator)',
  details: 'Collapsible or Accordion (ui/*)',
  summary: 'Collapsible or Accordion (ui/*)',
  kbd: 'Kbd (ui/kbd)',
  datalist: 'Combobox (ui/combobox)',
  optgroup: 'Select (ui/select)',
};
const WEB_LIBS = /from\s+['"](radix-ui(?:\/[\w-]+)?|@radix-ui\/[\w-]+|@base-ui\/react(?:\/[\w-]+)?|cmdk|embla-carousel-react|input-otp|react-day-picker|react-resizable-panels|echarts(?:\/[\w-]+)?|echarts-for-react(?:\/[\w-]+)?|recharts|vaul)['"]/;
const WEB_EL_RE = new RegExp(`<(${Object.keys(WEB_ELEMENTS).join('|')})(?=[\\s/>])`);

const ANDROID = [
  'Button', 'OutlinedButton', 'TextButton', 'ElevatedButton', 'FilledTonalButton', 'IconButton', 'FloatingActionButton',
  'ExtendedFloatingActionButton', 'Card', 'ElevatedCard', 'OutlinedCard', 'TextField', 'OutlinedTextField', 'Switch', 'Checkbox',
  'RadioButton', 'Slider', 'AlertDialog', 'BasicAlertDialog', 'ModalBottomSheet', 'BottomSheetScaffold', 'DropdownMenu',
  'DropdownMenuItem', 'ExposedDropdownMenuBox', 'CircularProgressIndicator', 'LinearProgressIndicator', 'Tab', 'TabRow',
  'ScrollableTabRow', 'Badge', 'HorizontalDivider', 'Divider', 'FilterChip', 'AssistChip', 'InputChip', 'SuggestionChip',
  'Snackbar', 'SnackbarHost', 'TopAppBar', 'CenterAlignedTopAppBar', 'LargeTopAppBar', 'NavigationBar', 'NavigationRail',
  'DatePicker', 'DatePickerDialog', 'TimePicker', 'SegmentedButton', 'SingleChoiceSegmentedButtonRow', 'Tooltip', 'TooltipBox',
  'ListItem', 'PullToRefreshBox',
];
const ANDROID_RE = new RegExp(`^\\s*import\\s+androidx\\.compose\\.material3\\.(?:${ANDROID.join('|')})\\s*$`);

const APPLE_CTRL = ['Button', 'TextField', 'SecureField', 'TextEditor', 'Toggle', 'Picker', 'Slider', 'Stepper', 'DatePicker', 'ProgressView', 'Menu', 'Divider', 'Gauge', 'DisclosureGroup', 'TabView', 'Table', 'Form', 'ColorPicker'];
const APPLE_RE = new RegExp(`(?<![\\w.])(?:${APPLE_CTRL.join('|')})\\s*(?:\\(|\\{)|\\.(?:sheet|fullScreenCover|alert|confirmationDialog|popover|contextMenu|swipeActions)\\s*\\(`);

const SLINT_RE = /^\s*import\s*\{[^}]*\}\s*from\s*"std-widgets\.slint"/;

const RULES = {
  web: {
    exts: ['tsx', 'jsx'],
    exempt: /^apps\/web\/shared\/ui\//,
    test: (line, ext) => {
      const m = WEB_EL_RE.exec(line);
      return m ? `<${m[1]}> -> use ${WEB_ELEMENTS[m[1]]}` : null;
    },
    imports: (line) => {
      const m = WEB_LIBS.exec(line);
      return m ? `import of "${m[1]}" -> only apps/web/shared/ui may wrap it; use the kit component` : null;
    },
  },
  android: {
    exts: ['kt'],
    exempt: /^apps\/android\/core\/(ui|ui-tv)\//,
    test: (line) => (ANDROID_RE.test(line) ? `${line.trim().replace(/^import\s+/, '')} -> use the Aedst* component from core/ui` : null),
  },
  apple: {
    exts: ['swift'],
    exempt: /^apps\/apple\/Core\/AedstDesignSystem\//,
    test: (line) => (APPLE_RE.test(line) ? 'raw SwiftUI control -> use the Aedst* component from AedstDesignSystem' : null),
  },
  desktop: {
    exts: ['slint'],
    exempt: /^apps\/desktop\/crates\/aedst-ui\//,
    test: (line) => (SLINT_RE.test(line) ? 'std-widgets import -> use aedst_*.slint from crates/aedst-ui' : null),
  },
};

const TEST_FILE = /(^|\/)(e2e|__tests__|__mocks__|testdata|fixtures|test|tests|androidTest|sharedTest|Tests?|mocks|gallery)\/|\.(test|spec|stories)\.[a-z]+$|Test\.kt$|Tests?\.swift$|Previews?\.(kt|swift)$/;
const NON_SOURCE = /(^|\/)(node_modules|build|dist|\.next|target|Derived|\.build|generated|Generated|kotlin-gen|gen)\//;
const IGNORE = /ui-kit-ignore:\s*\S/;
const COMMENT = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

const platformOf = (f) => /^apps\/(web|android|apple|desktop)\//.exec(f)?.[1] ?? null;
const found = [];
for (const f of files) {
  const platform = platformOf(f);
  if (!platform) continue;
  const rule = RULES[platform];
  const ext = f.split('.').pop();
  if (!rule.exts.includes(ext) || rule.exempt.test(f) || TEST_FILE.test(f) || NON_SOURCE.test(f)) continue;
  const abs = path.join(root, f);
  if (!existsSync(abs)) continue;
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (COMMENT.test(line)) return;
    if (IGNORE.test(line) || (i > 0 && IGNORE.test(lines[i - 1]))) return;
    const code = line.replace(/\s\/\/\s.*$/, ''); // trailing comment is not code
    const why = rule.test(code, ext) ?? rule.imports?.(code);
    if (why) found.push({ platform, file: f, line: i + 1, why, text: line.trim().slice(0, 100) });
  });
}

const baselineFile = 'scripts/ui-kit-only.baseline';
const baselinePath = path.join(root, baselineFile);
const counts = new Map();
for (const o of found) counts.set(o.file, (counts.get(o.file) ?? 0) + 1);

if (argv.has('--write-baseline')) {
  const native = [...counts].filter(([f]) => platformOf(f) !== 'web').sort(([a], [b]) => a.localeCompare(b));
  const head = '# UI-kit-only ratchet: raw native controls that predate the gate. A file may not exceed its count;\n# lower the number as you migrate it, delete the line at 0. Never add a line for new code. Web has none.\n';
  writeFileSync(baselinePath, head + native.map(([f, n]) => `${f} ${n}`).join('\n') + '\n');
  console.log(`wrote ${native.length} entries to ${baselineFile}`);
  process.exit(0);
}

const baseline = new Map();
if (existsSync(baselinePath)) {
  for (const l of readFileSync(baselinePath, 'utf8').split('\n')) {
    const m = /^(\S+)\s+(\d+)\s*$/.exec(l.replace(/\s+#.*/, ''));
    if (m) baseline.set(m[1], Number(m[2]));
  }
}
const gating = found.filter((o) => platformOf(o.file) === 'web' || counts.get(o.file) > (baseline.get(o.file) ?? 0));

if (argv.has('--json')) {
  console.log(JSON.stringify(gating, null, 2));
} else {
  for (const [p, items] of Map.groupBy(gating, (o) => o.platform)) {
    console.log(`\n== ${p}: ${items.length} raw control(s) in ${new Set(items.map((i) => i.file)).size} file(s)`);
    for (const i of items.slice(0, 40)) console.log(`  ${i.file}:${i.line}  ${i.why}\n      ${i.text}`);
    if (items.length > 40) console.log(`  ... ${items.length - 40} more (use --json)`);
  }
  const debt = [...baseline.values()].reduce((a, b) => a + b, 0);
  console.log(
    gating.length
      ? `\nFAIL: ${gating.length} raw control(s) outside the UI kit. Use the kit component (docs/content/ui-kit.md); if none fits, add it to the kit first. Exempt one line with "ui-kit-ignore: <reason>".`
      : `\nOK: feature code uses the UI kit only (native debt in baseline: ${debt}).`,
  );
}
process.exit(gating.length ? 1 : 0);

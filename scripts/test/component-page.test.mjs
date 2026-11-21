// Tests of the shared text helpers and the page renderer of the component reference
// (scripts/ui-kit/source.mjs, scripts/ui-kit/component-page.mjs).
// Run: node --test scripts/test/component-page.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mdx, renderAlias, renderPage, VERIFICATION } from '../ui-kit/component-page.mjs';
import { dedent, docBefore, firstSentence, mask } from '../ui-kit/source.mjs';

test('source helpers: mask keeps length and brackets outside strings and comments only', () => {
  const src = 'a("x)") // )\nb(`${c}`) /* ( */ d\'s';
  const masked = mask(src);
  assert.equal(masked.length, src.length);
  assert.equal(masked, 'a("  ")     \nb(`    `)         d\'s');
  assert.equal(dedent('\n    a\n      b\n\n    c  \n'), 'a\n  b\n\nc');
  assert.equal(docBefore('// not a doc\nfun x()', 13), null);
  assert.equal(docBefore('/// Swift doc.\n@MainActor\npublic struct X', 26, 'triple'), 'Swift doc.');
  assert.equal(firstSentence('Wraps [Foo], e.g. this. Then more.'), 'Wraps Foo, e.g. this.');
});

test('page: platform tabs, honest verification, deviations, native entries and renamed types', () => {
  const c = {
    variants: ['default'], sizes: [],
    deviations: { apple: { size: { values: ['sm', 'md'], reason: 'web has no <size> axis' } } },
    web: { status: 'implemented', file: 'sheet.tsx' },
    android: { status: 'implemented', file: 'AedstBottomSheet.kt' },
    apple: { status: 'implemented', file: 'AedstSheet.swift' },
    desktop: { status: 'native', note: 'PopupWindow' },
  };
  const x = (api, extra = {}) => ({ main: 'X', doc: null, api, example: { code: 'X()', kind: 'minimal' }, ...extra });
  const page = renderPage('sheet', c, { web: 'w/sheet.tsx', android: 'a/AedstBottomSheet.kt', apple: 's/AedstSheet.swift' }, {
    web: x('function Sheet()', { main: 'Sheet', doc: 'A panel {from} the edge. More.', axes: { variant: ['default'] } }),
    android: x('fun AedstBottomSheet()', { example: { code: 'Preview()', kind: 'preview', from: 'the `@Preview` function `P`' } }),
    apple: x(null),
  });
  assert.match(page, /^---\ntitle: "sheet"\ndescription: "A panel \{from\} the edge\."\n---\n\n\{\/\* GENERATED /);
  assert.match(page, /- On Android `sheet` is named `AedstBottomSheet`\./);
  assert.match(page, /- On Desktop `sheet` is native: PopupWindow\./);
  assert.match(page, /- Apple deviates on `size`: `sm`, `md`\. Reason: web has no \\<size\\> axis\./);
  assert.match(page, /<Tabs items=\{\["Web","Android","Apple","Desktop"\]\}>/);
  assert.ok(page.includes(`**Verification:** ${VERIFICATION.android}`));
  assert.match(page, /\*\*Usage\*\* \(from the `@Preview` function `P`\):\n\n```kotlin\nPreview\(\)\n```/);
  assert.match(page, /\*\*Public API:\*\* no signature could be extracted/);
  assert.match(page, /minimal example built from the signature/);
  assert.match(page, /<Tab value="Desktop">\n\n\*\*Status:\*\* native\./);
  assert.doesNotMatch(page, /\r/);
  assert.equal(mdx('a {b} `{c}` <d>'), 'a \\{b\\} `{c}` \\<d\\>');
  assert.match(renderAlias('toast', 'sonner', { web: '`Toaster`', android: '`AedstSnackbar`', apple: '`AedstToast`', desktop: '`AedstSonner`' }), /alias of \[`sonner`\]\(\/ui-kit\/components\/sonner\)[\s\S]*\| Android \| `AedstSnackbar` \|/);
});

// Tests of the pieces of scripts/check-ui-kit.mjs that can go wrong silently: the cva reader, the enum
// readers of the native kits, the deviations rule and the docs splice.
// Run: node --test scripts/test/check-ui-kit.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkUiKit } from '../check-ui-kit.mjs';
import { cvaAxes } from '../ui-kit/cva.mjs';
import { END, START, renderMatrix, spliceMatrix } from '../ui-kit/docs.mjs';
import { enumAxis, enumDeclarations, normalise } from '../ui-kit/enums.mjs';

test('cvaAxes reads variant and size names, quoted keys included', () => {
  const src = `
    const buttonVariants = cva("inline-flex [&_svg:not([class*='size-'])]:size-4", {
      variants: {
        variant: {
          default: "bg-primary",
          // a comment with variants: { fake: {} }
          outline:
            "border-border hover:bg-muted",
        },
        size: { default: "h-8", "icon-xs": "size-6", sm: \`h-7 \${x}\` },
      },
      defaultVariants: { variant: "default", size: "default" },
    });`;
  assert.deepEqual(cvaAxes(src), { variant: ['default', 'outline'], size: ['default', 'icon-xs', 'sm'] });
});

test('cvaAxes unions several cva calls and ignores a cva without variants', () => {
  const src = `
    const a = cva("x", { variants: { variant: { default: "", muted: "" } } });
    const b = cva("y");
    const c = cva("z", { variants: { variant: { default: "", icon: "" }, orientation: { horizontal: "" } } });`;
  assert.deepEqual(cvaAxes(src), { variant: ['default', 'muted', 'icon'], orientation: ['horizontal'] });
});

test('cvaAxes ignores a variants object outside cva', () => {
  assert.deepEqual(cvaAxes('const o = { variants: { variant: { a: 1 } } };'), {});
});

test('spliceMatrix replaces only the generated block and needs both markers', () => {
  const text = `intro\n${START}\nold\n${END}\noutro\n`;
  assert.equal(spliceMatrix(text, 'new'), `intro\n${START}\n\nnew\n\n${END}\noutro\n`);
  assert.equal(spliceMatrix('no markers', 'new'), null);
});

test('renderMatrix prints counts, statuses, aliases and extensions', () => {
  const doc = {
    platforms: { web: {}, apple: {} },
    components: {
      button: { variants: ['default'], sizes: [], web: { status: 'implemented', file: 'button.tsx' }, apple: { status: 'missing' } },
      toast: { alias: 'sonner' },
    },
    extensions: { web: ['marker.tsx'] },
  };
  const report = { web: { implemented: 1, native: 0, missing: 0 }, apple: { implemented: 0, native: 0, missing: 1 } };
  const out = renderMatrix(doc, report);
  assert.match(out, /\| Apple \| 0 \| 0 \| 1 \| 2 \|/);
  assert.match(out, /\| \[`button`\]\(\/ui-kit\/components\/button\) \| `default` \| - \| yes \(`button`\) \| missing \|/);
  assert.match(out, /\| \[`toast`\]\(\/ui-kit\/components\/toast\) \| alias of `sonner` \|/);
  assert.match(out, /\| Web \| `marker` \|/);
});

test('normalise ignores case and separators', () => {
  assert.deepEqual(['icon-sm', 'ICON_SM', 'iconSm', 'icon_sm'].map(normalise), Array(4).fill('iconsm'));
});

test('enumDeclarations reads Kotlin constants, with constructors and members', () => {
  const src = `
    /** enum class Fake { NOPE } */
    enum class AedstButtonSize(internal val height: Dp, val iconOnly: Boolean) {
        DEFAULT(40.dp, false), // enum class Other { X }
        ICON_SM(32.dp, true),
        ;
        fun pad() = when (this) { DEFAULT -> 1; ICON_SM -> 2 }
    }
    enum class AedstButtonVariant { DEFAULT, OUTLINE }`;
  assert.deepEqual(enumDeclarations(src, '.kt'), [
    { name: 'AedstButtonSize', values: ['DEFAULT', 'ICON_SM'] },
    { name: 'AedstButtonVariant', values: ['DEFAULT', 'OUTLINE'] },
  ]);
});

test('enumDeclarations reads Swift cases, not the cases of a switch, and skips namespaces', () => {
  const src = `
    public enum AedstItemVariant: String, Sendable {
        /// The plain row.
        case \`default\`
        case outline, muted = "m"
        case custom(Int)
        var id: String { switch self { case .outline: "o"
            case .muted: "m"
            default: "d" } }
    }
    enum AedstItemLogic { static func f() {} }`;
  assert.deepEqual(enumDeclarations(src, '.swift'), [{ name: 'AedstItemVariant', values: ['default', 'outline', 'muted', 'custom'] }]);
});

test('enumDeclarations reads Slint enums; enumAxis unions the enums that end with the axis name', () => {
  const src = `
    export enum AedstItemVariant { default, outline }
    export enum AedstItemMediaVariant { default, icon-sm }
    export enum AedstItemSize { default, sm }`;
  const found = enumDeclarations(src, '.slint');
  assert.deepEqual(enumAxis(found, 'variant'), ['default', 'outline', 'icon-sm']);
  assert.deepEqual(enumAxis(found, 'size'), ['default', 'sm']);
  assert.equal(enumAxis(found, 'orientation'), null);
});

/** A tree with one web component (no cva axes) and one Android file; returns the checker's errors. */
function nativeErrors(kotlin, component) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ui-kit-'));
  try {
    for (const dir of ['web', 'android']) mkdirSync(path.join(root, dir));
    writeFileSync(path.join(root, 'web', 'avatar.tsx'), 'export function Avatar() {}');
    writeFileSync(path.join(root, 'android', 'AedstAvatar.kt'), kotlin);
    const manifest = {
      platforms: { web: { root: 'web', reference: true }, android: { root: 'android' } },
      kit_files: { web: { ext: '.tsx' }, android: { ext: '.kt' } },
      components: {
        avatar: { variants: [], sizes: [], web: { status: 'implemented', file: 'avatar.tsx' }, android: { status: 'implemented', file: 'AedstAvatar.kt' }, ...component },
      },
    };
    writeFileSync(path.join(root, 'ui-kit.yaml'), JSON.stringify(manifest)); // JSON is YAML
    return checkUiKit(root).errors.filter((e) => !e.includes('differs from cva')); // the web stub has no cva
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a native enum that differs from the manifest fails unless a deviation with a reason lists it', () => {
  const kotlin = 'enum class AedstAvatarSize { SM, MD, LG }';
  const deviation = (size) => ({ deviations: { android: { size } } });
  assert.match(nativeErrors(kotlin, {}).join('\n'), /avatar on android: size differs from the enums in AedstAvatar\.kt; in the file but not declared: SM, MD, LG/);
  assert.deepEqual(nativeErrors(kotlin, deviation({ values: ['sm', 'md', 'lg'], reason: 'web has no size axis' })), []);
  assert.match(nativeErrors(kotlin, deviation({ values: ['sm', 'md', 'lg'] })).join('\n'), /needs a reason/);
  assert.match(nativeErrors(kotlin, deviation({ values: ['sm'], reason: 'stale' })).join('\n'), /deviation lists sm but AedstAvatar\.kt declares SM, MD, LG/);
  assert.match(nativeErrors(kotlin, { deviations: { web: { size: { values: ['sm'], reason: 'x' } } } }).join('\n'), /deviations\.web is not a non-reference platform/);
});

test('matching names pass whatever the spelling; an unneeded deviation and a missing entry fail', () => {
  const kotlin = 'enum class AedstAvatarSize { DEFAULT, ICON_SM }';
  assert.deepEqual(nativeErrors(kotlin, { sizes: ['default', 'icon-sm'] }), []);
  const unneeded = { sizes: ['default', 'icon-sm'], deviations: { android: { size: { values: ['default', 'iconSm'], reason: 'x' } } } };
  assert.match(nativeErrors(kotlin, unneeded).join('\n'), /repeats the canonical values/);
  assert.match(nativeErrors(kotlin, { android: { status: 'missing' } }).join('\n'), /avatar on android: missing/);
});

test('renderMatrix lists deviations with their reason', () => {
  const doc = {
    platforms: { web: {}, android: {} },
    components: {
      avatar: { variants: [], sizes: [], web: { status: 'implemented', file: 'avatar.tsx' }, android: { status: 'implemented', file: 'AedstAvatar.kt' }, deviations: { android: { size: { values: ['sm', 'md'], reason: 'because' } } } },
    },
  };
  const report = { web: { implemented: 1, native: 0, missing: 0 }, android: { implemented: 1, native: 0, missing: 0 } };
  assert.match(renderMatrix(doc, report), /\| \`avatar\` \| Android \| size \| \`sm\`, \`md\` \| because \|/);
});

/** Like nativeErrors, with a web source, extra manifest keys and extra files (path -> text) under the root. */
function treeErrors({ web = 'export function Avatar() {}', kotlin = 'fun AedstAvatar() {}', component = {}, manifest = {}, files = {} }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ui-kit-'));
  try {
    for (const dir of ['web', 'android']) mkdirSync(path.join(root, dir));
    writeFileSync(path.join(root, 'web', 'avatar.tsx'), web);
    writeFileSync(path.join(root, 'android', 'AedstAvatar.kt'), kotlin);
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      writeFileSync(path.join(root, f), text);
    }
    const doc = {
      platforms: { web: { root: 'web', reference: true }, android: { root: 'android' } },
      kit_files: { web: { ext: '.tsx' }, android: { ext: '.kt' } },
      components: {
        avatar: { variants: [], sizes: [], web: { status: 'implemented', file: 'avatar.tsx' }, android: { status: 'implemented', file: 'AedstAvatar.kt' }, ...component },
      },
      ...manifest,
    };
    writeFileSync(path.join(root, 'ui-kit.yaml'), JSON.stringify(doc));
    return checkUiKit(root).errors;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a web axis outside cva is read from a string-literal union prop', () => {
  const web = 'export function Avatar({ size = "default" }: { size?: "default" | "sm" | "lg" }) {}';
  const kotlin = 'enum class AedstAvatarSize { DEFAULT, SM, LG }';
  assert.deepEqual(treeErrors({ web, kotlin, component: { sizes: ['default', 'sm', 'lg'] } }), []);
  assert.match(treeErrors({ web, kotlin }).join('\n'), /avatar on web: size differs from cva \(or the prop union\) in avatar\.tsx; in cva but not declared: default, sm, lg/);
});

test('coverage: a component no test, story or gallery names fails; any symbol its file declares counts', () => {
  const coverage = { coverage: { android: { roots: ['tests'], suffix: ['.kt'] } } };
  assert.match(treeErrors({ manifest: coverage }).join('\n'), /avatar on android: not exercised/);
  assert.deepEqual(treeErrors({ manifest: coverage, files: { 'tests/AvatarTest.kt': 'AedstAvatar()' } }), []);
  const kotlin = 'fun AedstAvatar() {}\nenum class AedstAvatarShape { ROUND }';
  assert.deepEqual(treeErrors({ kotlin, manifest: coverage, files: { 'tests/T.kt': 'AedstAvatarShape.ROUND' } }), []);
  assert.match(treeErrors({ manifest: coverage, files: { 'tests/T.txt': 'AedstAvatar()' } }).join('\n'), /not exercised/);
});

test('props contract: every listed name must be a parameter on every platform, spelling aside', () => {
  const web = 'export function Avatar({ fallbackText, onLoadingStatusChange }: Props) {}';
  const kotlin = 'fun AedstAvatar(fallbackText: String, onLoadingStatusChange: (Boolean) -> Unit) {}';
  const props = { props: ['fallbackText', 'on-loading-status-change'] };
  assert.deepEqual(treeErrors({ web, kotlin, component: props }), []);
  assert.match(treeErrors({ web, component: props }).join('\n'), /avatar on android: props contract not met, AedstAvatar\.kt has no fallbackText, on-loading-status-change/);
});

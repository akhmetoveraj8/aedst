// Tests of the extraction behind the component reference (scripts/ui-kit/component-docs.mjs): what
// is read from a web, Android, Apple and Desktop kit file (the page renderer: component-page.test.mjs).
// Run: node --test scripts/test/component-docs.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractAndroid } from '../ui-kit/extract-android.mjs';
import { extractApple } from '../ui-kit/extract-apple.mjs';
import { extractDesktop, galleryUsage } from '../ui-kit/extract-desktop.mjs';
import { extractWeb, storyExample } from '../ui-kit/extract-web.mjs';
import { firstSentence } from '../ui-kit/source.mjs';

const KOTLIN = `package x

/** Visual treatment of [AedstButton]. */
enum class AedstButtonVariant { DEFAULT, OUTLINE }

/** One column over a row type [T]. */
class AedstColumn<T>(val header: String, val cell: (T) -> String)

private data class Hidden(val a: Int)

/**
 * Primary action control. Rewritten to match the standard: braces { in a comment.
 */
// A line comment between the doc and the annotations.
@Suppress("LongParameterList")
@Composable
fun AedstButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: AedstButtonVariant = AedstButtonVariant.DEFAULT,
    leadingIcon: (@Composable RowScope.() -> Unit)? = null,
    onPair: (Int, Int) -> Unit,
) {
    Text("a ) string { with brackets")
}

@Composable
private fun ButtonContent(text: String?) {}

@Composable
internal fun Internal() {}
`;

test('android: public composable signature, enums, public classes; private and internal are left out', () => {
  const x = extractAndroid(KOTLIN, 'AedstButton', 'Button');
  assert.equal(x.main, 'AedstButton');
  assert.deepEqual(x.names, ['AedstButton']);
  assert.equal(x.signatures, 1);
  assert.match(x.api, /^enum class AedstButtonVariant \{ DEFAULT, OUTLINE \}/);
  assert.match(x.api, /class AedstColumn<T>\(val header: String, val cell: \(T\) -> String\)/);
  assert.match(x.api, /@Composable\nfun AedstButton\(\n {4}text: String,[\s\S]*onPair: \(Int, Int\) -> Unit,\n\)$/);
  assert.doesNotMatch(x.api, /Hidden|ButtonContent|Internal|Text\(/);
  assert.equal(x.doc, 'Primary action control. Rewritten to match the standard: braces { in a comment.');
});

test('android: without @Preview the example is a minimal call with required parameters and the default variant', () => {
  const x = extractAndroid(KOTLIN, 'AedstButton', 'Button');
  assert.equal(x.example.kind, 'minimal');
  assert.equal(x.example.code, 'AedstButton(text = "Button", onClick = {}, variant = AedstButtonVariant.DEFAULT, onPair = { _, _ -> })');
});

test('android: the body of the @Preview function is the example', () => {
  const src = `${KOTLIN}
@Preview(name = "Light")
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstButtonPreview() {
    AedstTheme {
        AedstButton(text = "Save", onClick = {}, onPair = { _, _ -> })
    }
}
`;
  const x = extractAndroid(src, 'AedstButton', 'Button');
  assert.equal(x.example.kind, 'preview');
  assert.equal(x.example.code, 'AedstTheme {\n    AedstButton(text = "Save", onClick = {}, onPair = { _, _ -> })\n}');
  assert.deepEqual(x.names, ['AedstButton']);
});

const SWIFT = `import SwiftUI

/// Mirrors the \`variant\` prop.
public enum AedstBadgeVariant: Sendable, CaseIterable {
    case \`default\`
    case outline
}

/// Small status pill. Second sentence.
public struct AedstBadge<Icon: View>: View {
    private let text: String

    /// - Parameters:
    ///   - text: Visible text.
    public init(
        _ text: String,
        variant: AedstBadgeVariant = .default,
        isOn: Binding<Bool>,
        @ViewBuilder icon: () -> Icon,
        action: @escaping () -> Void
    ) {
        self.text = text
    }

    init(internalOnly: Int) { self.text = "" }

    public var body: some View {
        Text(text)
    }
}

struct Helper: View { var body: some View { EmptyView() } }

extension View {
    public func aedstBadge(_ text: String) -> some View {
        overlay { AedstBadge(text) }
    }
}
`;

test('apple: public struct with its public init, extension functions and enums', () => {
  const x = extractApple(SWIFT, 'AedstBadge', 'Badge');
  assert.equal(x.main, 'AedstBadge');
  assert.match(x.api, /^public enum AedstBadgeVariant \{ case `default`, outline \}/);
  assert.match(x.api, /public struct AedstBadge<Icon: View>: View \{\n {4}public init\(\n {8}_ text: String,[\s\S]*action: @escaping \(\) -> Void\n {4}\)\n\}/);
  assert.match(x.api, /extension View \{\n {4}public func aedstBadge\(_ text: String\) -> some View\n\}/);
  assert.doesNotMatch(x.api, /internalOnly|Helper|self\.text/);
  assert.equal(x.signatures, 2);
  assert.equal(firstSentence(x.doc), 'Small status pill.');
});

test('apple: #Preview body, else a minimal call from the initialiser', () => {
  const minimal = extractApple(SWIFT, 'AedstBadge', 'Badge').example;
  assert.equal(minimal.kind, 'minimal');
  assert.equal(minimal.code, 'AedstBadge("Badge", variant: .default, isOn: .constant(false), icon: { Text("Badge") }, action: {})');
  const preview = extractApple(`${SWIFT}\n#Preview("AedstBadge") {\n    VStack {\n        AedstBadge("New")\n    }\n    .padding()\n}\n`, 'AedstBadge', 'Badge').example;
  assert.equal(preview.kind, 'preview');
  assert.equal(preview.code, 'VStack {\n    AedstBadge("New")\n}\n.padding()');
});

const SLINT = `import { AedstTokens } from "aedst_tokens.slint";

export enum AedstButtonVariant { default, outline }
export struct AedstItem {
    title: string,
}

// A push button.
// Second line of the comment.
export component AedstButton inherits Rectangle {
    in property <string> text;
    // What a screen reader announces.
    in property <string> label: root.text;
    in property <AedstButtonVariant> variant: AedstButtonVariant.default;
    out property <bool> pressed: touch.pressed;
    in-out property <int> current: -1;
    callback clicked();
    pure callback filter(string) -> bool;
    public function show() {
        root.visible = true;
    }

    private property <bool> hot: root.pressed
        || touch.has-hover;
    function hidden() { }
    min-height: 32px;

    touch := TouchArea {
        clicked => { root.clicked(); }
    }
}
`;

test('desktop: exported component interface, structs and enums; private members and children are left out', () => {
  const x = extractDesktop(SLINT, 'aedst_button', []);
  assert.equal(x.main, 'AedstButton');
  assert.equal(x.signatures, 1);
  assert.equal(x.api, [
    'export enum AedstButtonVariant { default, outline }',
    'export struct AedstItem {\n    title: string,\n}',
    [
      'export component AedstButton inherits Rectangle {',
      '    in property <string> text;',
      '    in property <string> label: root.text;',
      '    in property <AedstButtonVariant> variant: AedstButtonVariant.default;',
      '    out property <bool> pressed: touch.pressed;',
      '    in-out property <int> current: -1;',
      '    callback clicked();',
      '    pure callback filter(string) -> bool;',
      '    public function show();',
      '}',
    ].join('\n'),
  ].join('\n\n'));
  assert.equal(x.doc, 'A push button. Second line of the comment.');
  assert.deepEqual(x.example, { code: 'AedstButton { variant: AedstButtonVariant.default; }', kind: 'minimal' });
});

test('desktop: the first gallery usage is the example; an import or a declaration is not a usage', () => {
  const gallery = [{
    path: 'ui/gallery/a.slint',
    src: 'import { AedstButton } from "../lib.slint";\nexport component Page {\n    HorizontalLayout {\n        save := AedstButton {\n            text: "Save";\n            clicked => { debug("}"); }\n        }\n    }\n}\n',
  }];
  assert.deepEqual(galleryUsage(['AedstButton'], gallery), { code: 'save := AedstButton {\n    text: "Save";\n    clicked => { debug("}"); }\n}', path: 'ui/gallery/a.slint' });
  assert.equal(galleryUsage(['AedstButtonGroup'], gallery), null);
  assert.equal(extractDesktop(SLINT, 'aedst_button', gallery).example.kind, 'gallery');
});

const TSX = `import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva("inline-flex", {
  variants: { variant: { default: "a", outline: "b" }, size: { default: "h-8", "icon-xs": "size-6" } },
});

interface ButtonProps {
  /** Shown while loading. */
  label: string;
}

/** The one button. It's used everywhere. */
function Button({
  className,
  variant = "default",
  ...props
}: ButtonProps & VariantProps<typeof buttonVariants>) {
  return <button className={className} {...props}>Don't</button>;
}

function Private() { return null; }

function ButtonIcon<T extends string>({ name }: { name: T }): React.ReactNode {
  return null;
}

export { Button, ButtonIcon, buttonVariants, type ButtonProps };
`;

test('web: exported names, function signatures, Props types, cva axes and the doc comment', () => {
  const x = extractWeb('button', [{ path: 'button.tsx', src: TSX }], null, '@/shared/ui/button');
  assert.equal(x.main, 'Button');
  assert.deepEqual(x.names, ['Button', 'ButtonIcon', 'buttonVariants']);
  assert.deepEqual(x.axes, { variant: ['default', 'outline'], size: ['default', 'icon-xs'] });
  assert.match(x.api, /^import \{ Button, ButtonIcon, buttonVariants, type ButtonProps \} from "@\/shared\/ui\/button";/);
  assert.match(x.api, /interface ButtonProps \{\n {2}\/\*\* Shown while loading\. \*\/\n {2}label: string;\n\}/);
  assert.match(x.api, /function Button\(\{\n {2}className,\n {2}variant = "default",\n {2}\.\.\.props\n\}: ButtonProps & VariantProps<typeof buttonVariants>\)/);
  assert.match(x.api, /function ButtonIcon<T extends string>\(\{ name \}: \{ name: T \}\): React\.ReactNode$/);
  assert.doesNotMatch(x.api, /Private|return/);
  assert.equal(x.signatures, 2);
  assert.equal(firstSentence(x.doc), 'The one button.');
  assert.deepEqual(x.example, { code: '<Button variant="default" />', kind: 'minimal' });
});

const story = (first) => `import { Button } from "@/shared/ui/button";
function Wrapped(props: { a?: boolean }) {
  return <Button {...props}>Wrapped</Button>;
}
const meta = {
  title: "UI/Button",
  component: COMPONENT,
  args: { children: "Button", "aria-label": "Save" },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
${first}
export const Second: Story = { render: () => <i /> };
`;

test('web: the first story is the example (render, local wrapper, or args)', () => {
  const render = storyExample(story('export const Variants: Story = {\n  render: (args) => (\n    <div>\n      <Button {...args}>A</Button>\n    </div>\n  ),\n};').replace('COMPONENT', 'Button'));
  assert.deepEqual(render, { code: '// args: { children: "Button", "aria-label": "Save" }\n<div>\n  <Button {...args}>A</Button>\n</div>', story: 'Variants' });
  const args = storyExample(story('export const Default: Story = { args: { disabled: true, size: "sm", count: 3 } };').replace('COMPONENT', 'Button'));
  assert.deepEqual(args, { code: '<Button aria-label="Save" disabled size="sm" count={3}>Button</Button>', story: 'Default' });
  const wrapper = storyExample(story('export const Default: Story = {};').replace('COMPONENT', 'Wrapped'));
  assert.deepEqual(wrapper, { code: 'function Wrapped(props: { a?: boolean }) {\n  return <Button {...props}>Wrapped</Button>;\n}', story: 'Default' });
  assert.equal(storyExample('export const x = 1;'), null);
});

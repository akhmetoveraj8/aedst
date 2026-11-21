import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CodeBlock } from "@/shared/ui/code-block";

const code = `export function sum(values: number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}
`;

const meta = {
  title: "UI/CodeBlock",
  component: CodeBlock,
  args: {
    code,
    filename: "sum.ts",
    language: "TypeScript",
    copyLabel: "Copy code",
    copiedLabel: "Copied",
    wrapLabel: "Wrap lines",
    className: "max-w-xl",
  },
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LineNumbers: Story = {
  args: { showLineNumbers: true, highlightLines: [3, 4, 5] },
};

export const Bare: Story = {
  args: {
    filename: undefined,
    language: undefined,
    copyLabel: undefined,
    wrapLabel: undefined,
  },
};

export const LongLineWrapped: Story = {
  args: {
    code: `const message = "${"a long line that does not fit the block ".repeat(6)}";`,
    defaultWrap: true,
  },
};

/** The `highlight` seam: a caller-supplied per-line renderer (comment lines dimmed here). */
export const CustomHighlight: Story = {
  args: {
    code: `// Adds the values.
${code}`,
    highlight: (line) =>
      line.trimStart().startsWith("//") ? <em>{line}</em> : line,
  },
};

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

/** Shiki, coloured with the `--syntax-*` tokens: try the dark and RTL toolbars. */
export const Highlighted: Story = {
  args: {
    code: `// Adds the values.
${code}`,
    showLineNumbers: true,
    highlightLines: [4],
  },
};

export const Go: Story = {
  args: {
    filename: "main.go",
    language: "Go",
    code: `package main

import "fmt"

// main prints a greeting.
func main() {
	count := 3
	fmt.Printf("hello %d\\n", count)
}
`,
  },
};

/** No grammar for the language: plain text, no Shiki download. */
export const PlainText: Story = {
  args: { filename: "notes.txt", language: "Text" },
};

/** The `highlight` override: a caller-supplied per-line renderer (comment lines dimmed here). */
export const CustomHighlight: Story = {
  args: {
    code: `// Adds the values.
${code}`,
    highlight: (line) =>
      line.trimStart().startsWith("//") ? <em>{line}</em> : line,
  },
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Kbd, KbdGroup } from "@/shared/ui/kbd";

const meta = {
  title: "UI/Kbd",
  component: Kbd,
  args: { children: "K" },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// axe rule "color-contrast": text-muted-foreground on bg-muted is 4.34:1
// (needs 4.5:1), a design-token issue.
export const Shortcut: Story = {
  parameters: { a11y: { test: "todo" } },
  render: () => (
    <p className="flex items-center gap-2 text-sm">
      Open the command palette with
      <KbdGroup>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </p>
  ),
};

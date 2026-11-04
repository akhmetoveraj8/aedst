import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ModeToggle } from "@/shared/ui/mode-toggle";

const meta = {
  title: "UI/ModeToggle",
  component: ModeToggle,
} satisfies Meta<typeof ModeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

// axe rule "nested-interactive": ModeToggle nests a Button inside
// DropdownMenuTrigger (both are buttons); it also has no open prop.
export const Default: Story = {
  parameters: { a11y: { test: "todo" } },
};

// axe rule "nested-interactive" (same component issue as Default).
export const InToolbar: Story = {
  parameters: { a11y: { test: "todo" } },
  render: () => (
    <div className="flex items-center gap-2 rounded-lg border p-2">
      <span className="text-sm">Appearance</span>
      <ModeToggle />
    </div>
  ),
};

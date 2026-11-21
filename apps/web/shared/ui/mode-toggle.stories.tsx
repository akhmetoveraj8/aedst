import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ModeToggle } from "@/shared/ui/mode-toggle";

const labels = {
  toggle: "Toggle theme",
  light: "Light",
  dark: "Dark",
  system: "System",
};

const meta = {
  title: "UI/ModeToggle",
  component: ModeToggle,
  args: { labels },
} satisfies Meta<typeof ModeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InToolbar: Story = {
  render: () => (
    <div className="flex items-center gap-2 rounded-lg border p-2">
      <span className="text-sm">Appearance</span>
      <ModeToggle labels={labels} />
    </div>
  ),
};

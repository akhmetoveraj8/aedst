import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Separator } from "@/shared/ui/separator";

const meta = {
  title: "UI/Separator",
  component: Separator,
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="w-64 text-sm">
      <p className="font-medium">Account</p>
      <p className="text-muted-foreground">Manage your profile</p>
      <Separator {...args} className="my-3" />
      <p>Settings below</p>
    </div>
  ),
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  render: (args) => (
    <div className="flex h-5 items-center gap-3 text-sm">
      <span>Blog</span>
      <Separator {...args} />
      <span>Docs</span>
      <Separator {...args} />
      <span>Source</span>
    </div>
  ),
};

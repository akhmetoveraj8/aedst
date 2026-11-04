import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Label } from "@/shared/ui/label";

const meta = {
  title: "UI/Label",
  component: Label,
  args: { children: "Email address", htmlFor: "label-email" },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <Label {...args} />
      <input
        id="label-email"
        type="email"
        className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
      />
    </div>
  ),
};

export const WithCheckbox: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <input id="label-terms" type="checkbox" className="peer size-4" />
      <Label htmlFor="label-terms">Accept terms and conditions</Label>
    </div>
  ),
};

export const DisabledPeer: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <input id="label-off" type="checkbox" disabled className="peer size-4" />
      <Label htmlFor="label-off">Unavailable option</Label>
    </div>
  ),
};

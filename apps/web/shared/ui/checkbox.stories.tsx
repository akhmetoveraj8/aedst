import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Checkbox } from "@/shared/ui/checkbox";

const meta = {
  title: "UI/Checkbox",
  component: Checkbox,
  args: { "aria-label": "Accept terms" },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = { args: { defaultChecked: true } };

export const Disabled: Story = { args: { disabled: true } };

export const Invalid: Story = { args: { "aria-invalid": true } };

export const WithLabel: Story = {
  render: (args) => (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox {...args} aria-label={undefined} />
      Subscribe to updates
    </label>
  ),
};

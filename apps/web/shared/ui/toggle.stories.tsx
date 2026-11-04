import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Toggle } from "@/shared/ui/toggle";

const meta = {
  title: "UI/Toggle",
  component: Toggle,
  args: { children: "Bold", "aria-label": "Toggle bold" },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Outline: Story = { args: { variant: "outline" } };

export const Pressed: Story = { args: { defaultPressed: true } };

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Toggle {...args} size="sm" aria-label="Small">
        Small
      </Toggle>
      <Toggle {...args} aria-label="Default">
        Default
      </Toggle>
      <Toggle {...args} size="lg" aria-label="Large">
        Large
      </Toggle>
    </div>
  ),
};

export const Disabled: Story = { args: { disabled: true } };

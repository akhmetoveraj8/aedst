import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Slider } from "@/shared/ui/slider";

const meta = {
  title: "UI/Slider",
  component: Slider,
  args: { defaultValue: [40], "aria-label": "Volume" },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Range: Story = {
  args: { defaultValue: [20, 70], "aria-label": "Price range" },
};

export const Disabled: Story = { args: { disabled: true } };

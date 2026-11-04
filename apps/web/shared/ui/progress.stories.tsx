import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Progress, ProgressLabel, ProgressValue } from "@/shared/ui/progress";

const meta = {
  title: "UI/Progress",
  component: Progress,
  args: { value: 40, "aria-label": "Upload progress" },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLabelAndValue: Story = {
  args: { value: 72 },
  render: (args) => (
    <Progress {...args}>
      <ProgressLabel>Uploading</ProgressLabel>
      <ProgressValue />
    </Progress>
  ),
};

export const Complete: Story = { args: { value: 100 } };

export const Indeterminate: Story = { args: { value: null } };

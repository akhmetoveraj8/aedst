import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Spinner } from "@/shared/ui/spinner";

const meta = {
  title: "UI/Spinner",
  component: Spinner,
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Spinner className="size-4" />
      <Spinner className="size-6" />
      <Spinner className="size-10 text-primary" />
    </div>
  ),
};

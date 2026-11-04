import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { LoadingSkeleton } from "@/shared/ui/loading-skeleton";
import { Skeleton } from "@/shared/ui/skeleton";

const meta = {
  title: "UI/LoadingSkeleton",
  component: LoadingSkeleton,
  args: { className: "h-16 w-64" },
} satisfies Meta<typeof LoadingSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Block: Story = {};

export const WithPlaceholders: Story = {
  render: () => (
    <LoadingSkeleton className="flex flex-col gap-2">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-16 w-64" />
    </LoadingSkeleton>
  ),
};

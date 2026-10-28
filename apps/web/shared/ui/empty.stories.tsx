import { Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "@/shared/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/ui/empty";

const meta = {
  title: "UI/Empty",
  component: Empty,
  render: (args) => (
    <Empty {...args} className="w-96 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>No projects yet</EmptyTitle>
        <EmptyDescription>
          You have not created any projects. Get started by creating one.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>Create project</Button>
      </EmptyContent>
    </Empty>
  ),
} satisfies Meta<typeof Empty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const TextOnly: Story = {
  render: (args) => (
    <Empty {...args} className="w-96 border">
      <EmptyHeader>
        <EmptyTitle>Nothing to show</EmptyTitle>
        <EmptyDescription>Try adjusting your filters.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
};

import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Marker, MarkerContent, MarkerIcon } from "@/shared/ui/marker";

const meta = {
  title: "UI/Marker",
  component: Marker,
  argTypes: {
    variant: { control: "select", options: ["default", "separator", "border"] },
  },
} satisfies Meta<typeof Marker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Marker {...args}>
      <MarkerIcon>
        <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
      </MarkerIcon>
      <MarkerContent>Conversation started today</MarkerContent>
    </Marker>
  ),
};

export const Separator: Story = {
  render: (args) => (
    <Marker {...args} variant="separator">
      <MarkerContent>Yesterday</MarkerContent>
    </Marker>
  ),
};

export const Border: Story = {
  render: (args) => (
    <Marker {...args} variant="border">
      <MarkerContent>Earlier messages</MarkerContent>
    </Marker>
  ),
};

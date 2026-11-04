import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "@/shared/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/shared/ui/popover";

const meta = {
  title: "UI/Popover",
  component: Popover,
  args: { defaultOpen: true },
  parameters: { layout: "centered" },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="flex h-48 items-start">
      <Popover {...args}>
        <PopoverTrigger render={<Button variant="outline" />}>
          Open popover
        </PopoverTrigger>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>Dimensions</PopoverTitle>
            <PopoverDescription>
              Set the dimensions for the layer.
            </PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>
    </div>
  ),
};

export const TopAligned: Story = {
  render: (args) => (
    <div className="flex h-48 items-end">
      <Popover {...args}>
        <PopoverTrigger render={<Button variant="secondary" />}>
          Notes
        </PopoverTrigger>
        <PopoverContent side="top" align="start">
          <PopoverTitle>Quick note</PopoverTitle>
          <PopoverDescription>Opens above the trigger.</PopoverDescription>
        </PopoverContent>
      </Popover>
    </div>
  ),
};

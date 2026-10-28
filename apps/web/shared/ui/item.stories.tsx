import { Notification01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "@/shared/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/shared/ui/item";

const meta = {
  title: "UI/Item",
  component: Item,
  args: { variant: "outline" },
  argTypes: {
    variant: { control: "select", options: ["default", "outline", "muted"] },
    size: { control: "select", options: ["default", "sm"] },
  },
  render: (args) => (
    <Item {...args} className="w-96">
      <ItemMedia variant="icon">
        <HugeiconsIcon icon={Notification01Icon} strokeWidth={2} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Security alert</ItemTitle>
        <ItemDescription>New login from a recognised device.</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="outline">
          Review
        </Button>
      </ItemActions>
    </Item>
  ),
} satisfies Meta<typeof Item>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Muted: Story = { args: { variant: "muted", size: "sm" } };

export const Group: Story = {
  render: () => (
    <ItemGroup className="w-96">
      <Item>
        <ItemContent>
          <ItemTitle>First item</ItemTitle>
          <ItemDescription>Description for the first item.</ItemDescription>
        </ItemContent>
      </Item>
      <ItemSeparator />
      <Item>
        <ItemContent>
          <ItemTitle>Second item</ItemTitle>
          <ItemDescription>Description for the second item.</ItemDescription>
        </ItemContent>
      </Item>
    </ItemGroup>
  ),
};

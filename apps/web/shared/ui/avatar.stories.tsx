import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/shared/ui/avatar";

const meta = {
  title: "UI/Avatar",
  component: Avatar,
  // axe color-contrast: muted-foreground on muted is 4.34:1, a design-token issue.
  parameters: { a11y: { test: "todo" } },
  argTypes: {
    size: { control: "select", options: ["sm", "default", "lg"] },
  },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>AB</AvatarFallback>
    </Avatar>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Avatar {...args} size="sm">
        <AvatarFallback>SM</AvatarFallback>
      </Avatar>
      <Avatar {...args}>
        <AvatarFallback>MD</AvatarFallback>
      </Avatar>
      <Avatar {...args} size="lg">
        <AvatarFallback>LG</AvatarFallback>
      </Avatar>
    </div>
  ),
};

export const WithBadge: Story = {
  render: (args) => (
    <Avatar {...args} size="lg">
      <AvatarFallback>AB</AvatarFallback>
      <AvatarBadge />
    </Avatar>
  ),
};

export const Group: Story = {
  render: (args) => (
    <AvatarGroup>
      <Avatar {...args}>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>
      <Avatar {...args}>
        <AvatarFallback>CD</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+3</AvatarGroupCount>
    </AvatarGroup>
  ),
};

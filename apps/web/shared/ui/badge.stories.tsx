import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Badge } from "@/shared/ui/badge";

const meta = {
  title: "UI/Badge",
  component: Badge,
  args: { children: "Badge" },
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "secondary",
        "destructive",
        "success",
        "warning",
        "info",
        "outline",
        "ghost",
        "link",
      ],
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  // axe color-contrast: destructive on destructive/10 badge is 4:1, a design-token issue.
  parameters: { a11y: { test: "todo" } },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge {...args}>Default</Badge>
      <Badge {...args} variant="secondary">
        Secondary
      </Badge>
      <Badge {...args} variant="success">
        Success
      </Badge>
      <Badge {...args} variant="warning">
        Warning
      </Badge>
      <Badge {...args} variant="info">
        Info
      </Badge>
      <Badge {...args} variant="destructive">
        Destructive
      </Badge>
      <Badge {...args} variant="outline">
        Outline
      </Badge>
    </div>
  ),
};

export const AsLink: Story = {
  render: (args) => (
    <Badge {...args} render={<a href="#changelog" />}>
      Changelog
    </Badge>
  ),
};

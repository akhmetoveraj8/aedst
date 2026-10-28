import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "@/shared/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";

const meta = {
  title: "UI/Card",
  component: Card,
  argTypes: { size: { control: "select", options: ["default", "sm"] } },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Project</CardTitle>
        <CardDescription>Manage your project settings.</CardDescription>
      </CardHeader>
      <CardContent>Card content goes here.</CardContent>
    </Card>
  ),
};

export const WithActionAndFooter: Story = {
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>Invite people to collaborate.</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline">
            Invite
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>Three members.</CardContent>
      <CardFooter>
        <Button size="sm">Save</Button>
      </CardFooter>
    </Card>
  ),
};

export const Small: Story = {
  args: { size: "sm" },
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Compact</CardTitle>
        <CardDescription>Smaller spacing.</CardDescription>
      </CardHeader>
    </Card>
  ),
};

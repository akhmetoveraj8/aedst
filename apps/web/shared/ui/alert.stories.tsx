import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

const meta = {
  title: "UI/Alert",
  component: Alert,
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Alert {...args}>
      <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>You can add components to your app.</AlertDescription>
    </Alert>
  ),
};

export const Destructive: Story = {
  // axe color-contrast: destructive text on card is 4.49:1 (needs 4.5:1), a design-token issue.
  parameters: { a11y: { test: "todo" } },
  render: (args) => (
    <Alert {...args} variant="destructive">
      <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
      <AlertTitle>Payment failed</AlertTitle>
      <AlertDescription>Check your card details and retry.</AlertDescription>
    </Alert>
  ),
};

export const WithAction: Story = {
  render: (args) => (
    <Alert {...args}>
      <AlertTitle>Update available</AlertTitle>
      <AlertDescription>A new version is ready to install.</AlertDescription>
      <AlertAction>
        <Button size="xs" variant="outline">
          Update
        </Button>
      </AlertAction>
    </Alert>
  ),
};

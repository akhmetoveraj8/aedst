import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/shared/ui/hover-card";

const meta = {
  title: "UI/HoverCard",
  component: HoverCard,
  args: { defaultOpen: true },
  decorators: [
    (Story) => (
      <div className="flex min-h-48 items-start justify-center pt-4">
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <HoverCard {...args}>
      <HoverCardTrigger
        href="https://example.com/aedst"
        className="text-sm font-medium underline"
      >
        @aedst
      </HoverCardTrigger>
      <HoverCardContent>
        <p className="text-sm font-medium">AEDST</p>
        <p className="text-sm text-muted-foreground">
          Cross-platform product built with a shared design system.
        </p>
      </HoverCardContent>
    </HoverCard>
  ),
} satisfies Meta<typeof HoverCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Top: Story = {
  render: (args) => (
    <HoverCard {...args}>
      <HoverCardTrigger
        href="https://example.com/aedst"
        className="mt-24 text-sm font-medium underline"
      >
        @aedst
      </HoverCardTrigger>
      <HoverCardContent side="top">
        <p className="text-sm">Opens above the trigger.</p>
      </HoverCardContent>
    </HoverCard>
  ),
};

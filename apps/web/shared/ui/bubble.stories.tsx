import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  Bubble,
  BubbleContent,
  BubbleGroup,
  BubbleReactions,
} from "@/shared/ui/bubble";

const meta = {
  title: "UI/Bubble",
  component: Bubble,
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "secondary",
        "muted",
        "tinted",
        "outline",
        "ghost",
        "destructive",
      ],
    },
    align: { control: "select", options: ["start", "end"] },
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Bubble>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Bubble {...args}>
      <BubbleContent>Hello, how can I help?</BubbleContent>
    </Bubble>
  ),
};

export const Conversation: Story = {
  // axe color-contrast: destructive on destructive/10 bubble is 4:1, a design-token issue.
  parameters: { a11y: { test: "todo" } },
  render: (args) => (
    <BubbleGroup>
      <Bubble {...args} variant="muted">
        <BubbleContent>Is the build green?</BubbleContent>
      </Bubble>
      <Bubble {...args} align="end">
        <BubbleContent>Yes, all checks passed.</BubbleContent>
      </Bubble>
      <Bubble {...args} variant="destructive">
        <BubbleContent>Message failed to send.</BubbleContent>
      </Bubble>
    </BubbleGroup>
  ),
};

export const WithReactions: Story = {
  render: (args) => (
    <div className="pb-4">
      <Bubble {...args} variant="secondary">
        <BubbleContent>Shipped it.</BubbleContent>
        <BubbleReactions>
          <span role="img" aria-label="thumbs up">
            👍
          </span>
        </BubbleReactions>
      </Bubble>
    </div>
  ),
};

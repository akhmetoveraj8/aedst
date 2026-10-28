import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "@/shared/ui/message";

const meta = {
  title: "UI/Message",
  component: Message,
  argTypes: { align: { control: "select", options: ["start", "end"] } },
} satisfies Meta<typeof Message>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Message {...args}>
      <MessageAvatar>
        <span className="px-2 text-xs">AI</span>
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>Assistant</MessageHeader>
        <div className="rounded-lg bg-muted px-3 py-2">
          Hello! How can I help you today?
        </div>
        <MessageFooter>10:24</MessageFooter>
      </MessageContent>
    </Message>
  ),
};

export const Conversation: Story = {
  render: () => (
    <MessageGroup>
      <Message>
        <MessageContent>
          <div className="w-fit rounded-lg bg-muted px-3 py-2">
            What changed in the last release?
          </div>
        </MessageContent>
      </Message>
      <Message align="end">
        <MessageContent>
          <div className="w-fit rounded-lg bg-primary px-3 py-2 text-primary-foreground">
            Mostly bug fixes and a faster startup.
          </div>
          <MessageFooter>Delivered</MessageFooter>
        </MessageContent>
      </Message>
    </MessageGroup>
  ),
};

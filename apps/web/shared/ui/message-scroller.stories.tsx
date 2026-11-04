import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/shared/ui/message-scroller";

const meta = {
  title: "UI/MessageScroller",
  component: MessageScroller,
  decorators: [
    (Story) => (
      <div className="h-64 w-80 rounded-lg border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MessageScroller>;

export default meta;
type Story = StoryObj<typeof meta>;

const messages = Array.from({ length: 20 }, (_, index) => ({
  id: `message-${index + 1}`,
  text: `Message number ${index + 1}`,
}));

export const Default: Story = {
  render: (args) => (
    <MessageScrollerProvider>
      <MessageScroller {...args}>
        <MessageScrollerViewport aria-label="Conversation" tabIndex={0}>
          <MessageScrollerContent className="p-3">
            {messages.map((message) => (
              <MessageScrollerItem key={message.id} messageId={message.id}>
                <p className="rounded-lg bg-muted px-3 py-2 text-sm">
                  {message.text}
                </p>
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  ),
};

export const StartPosition: Story = {
  render: (args) => (
    <MessageScrollerProvider defaultScrollPosition="start" autoScroll={false}>
      <MessageScroller {...args}>
        <MessageScrollerViewport
          aria-label="Conversation from the start"
          tabIndex={0}
        >
          <MessageScrollerContent className="p-3">
            {messages.map((message) => (
              <MessageScrollerItem key={message.id} messageId={message.id}>
                <p className="rounded-lg bg-muted px-3 py-2 text-sm">
                  {message.text}
                </p>
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton direction="end" />
      </MessageScroller>
    </MessageScrollerProvider>
  ),
};

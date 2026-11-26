import {
  Copy01Icon,
  RefreshIcon,
  ThumbsUpIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AiMessage,
  AiMessageAction,
  AiMessageActions,
  AiMessageContent,
  AiMessageResponse,
} from "@/shared/ui/ai-message";

const meta = {
  title: "UI/AI/Message",
  component: AiMessage,
  args: { from: "assistant", className: "max-w-md" },
  argTypes: {
    from: { control: "select", options: ["user", "assistant", "system"] },
  },
} satisfies Meta<typeof AiMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="flex max-w-md flex-col gap-6">
      <AiMessage from="user">
        <AiMessageContent>How do I add a settings dialog?</AiMessageContent>
      </AiMessage>
      <AiMessage {...args}>
        <AiMessageContent>
          <AiMessageResponse>
            {
              "Install Dialog, then open it from the gear button.\nThe dialog keeps its own form state."
            }
          </AiMessageResponse>
          <AiMessageActions>
            <AiMessageAction label="Copy">
              <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
            </AiMessageAction>
            <AiMessageAction label="Good response" aria-pressed={false}>
              <HugeiconsIcon icon={ThumbsUpIcon} strokeWidth={2} />
            </AiMessageAction>
            <AiMessageAction label="Retry">
              <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
            </AiMessageAction>
          </AiMessageActions>
        </AiMessageContent>
      </AiMessage>
    </div>
  ),
};

export const Streaming: Story = {
  render: (args) => (
    <AiMessage {...args}>
      <AiMessageContent>
        <AiMessageResponse streaming>
          Reading the settings page and its tests
        </AiMessageResponse>
      </AiMessageContent>
    </AiMessage>
  ),
};

/** The markdown slot: the app passes its renderer; the kit renders plain text without it. */
export const MarkdownSlot: Story = {
  render: (args) => (
    <AiMessage {...args}>
      <AiMessageContent>
        <AiMessageResponse
          renderMarkdown={(markdown) => (
            <p className="font-medium">{markdown.replaceAll("**", "")}</p>
          )}
        >
          {"**Done.** The dialog opens from the gear button."}
        </AiMessageResponse>
      </AiMessageContent>
    </AiMessage>
  ),
};

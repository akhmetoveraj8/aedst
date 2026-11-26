import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AiReasoning,
  AiReasoningContent,
  AiReasoningTrigger,
} from "@/shared/ui/ai-reasoning";

const text = `The user wants dark mode on the settings page.
First check how the theme is stored, then add a toggle under Appearance.`;

const meta = {
  title: "UI/AI/Reasoning",
  component: AiReasoning,
  args: { className: "max-w-md" },
  render: (args) => (
    <AiReasoning {...args}>
      <AiReasoningTrigger
        thinkingLabel="Thinking"
        thoughtLabel="Thought for 5 s"
      />
      <AiReasoningContent>{text}</AiReasoningContent>
    </AiReasoning>
  ),
} satisfies Meta<typeof AiReasoning>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Streaming: open, with a spinner. */
export const Streaming: Story = { args: { isStreaming: true } };

/** Finished: closed until the user opens it. */
export const Finished: Story = {};

export const FinishedOpen: Story = { args: { defaultOpen: true } };

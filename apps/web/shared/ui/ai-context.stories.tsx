import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import {
  AiContext,
  AiContextCacheUsage,
  AiContextContent,
  AiContextContentBody,
  AiContextContentFooter,
  AiContextContentHeader,
  AiContextInputUsage,
  AiContextOutputUsage,
  AiContextReasoningUsage,
  AiContextTrigger,
} from "@/shared/ui/ai-context";

const meta = {
  title: "UI/AI/Context",
  component: AiContext,
  args: {
    usedTokens: 10660,
    maxTokens: 128000,
    usage: {
      inputTokens: 8420,
      outputTokens: 1260,
      reasoningTokens: 980,
      cachedInputTokens: 2048,
    },
  },
  render: (args) => (
    <AiContext {...args}>
      <AiContextTrigger label="Context used" />
      <AiContextContent>
        <AiContextContentHeader label="Context" />
        <AiContextContentBody>
          <AiContextInputUsage label="Input" />
          <AiContextOutputUsage label="Output" />
          <AiContextReasoningUsage label="Reasoning" />
          <AiContextCacheUsage label="Cache" />
        </AiContextContentBody>
        <AiContextContentFooter>
          <span>Model</span>
          <span>Large</span>
        </AiContextContentFooter>
      </AiContextContent>
    </AiContext>
  ),
} satisfies Meta<typeof AiContext>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.hover(canvas.getByRole("button", { name: /Context used/ }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(
      await body.findByRole("progressbar", { name: "Context" }),
    ).toBeInTheDocument();
  },
};

export const NearlyFull: Story = {
  args: { usedTokens: 121000, maxTokens: 128000, usage: undefined },
};

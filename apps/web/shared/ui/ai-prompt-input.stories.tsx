import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  AiModelSelector,
  AiModelSelectorContent,
  AiModelSelectorItem,
  AiModelSelectorList,
  AiModelSelectorTrigger,
} from "@/shared/ui/ai-model-selector";
import {
  AiPromptInput,
  AiPromptInputAttachButton,
  AiPromptInputFooter,
  AiPromptInputHeader,
  AiPromptInputSubmit,
  AiPromptInputTextarea,
  AiPromptInputTools,
} from "@/shared/ui/ai-prompt-input";

const meta = {
  title: "UI/AI/PromptInput",
  component: AiPromptInput,
  args: { onSubmit: fn(), status: "ready", className: "max-w-lg" },
  argTypes: {
    status: {
      control: "select",
      options: ["ready", "submitted", "streaming", "error"],
    },
  },
  render: (args) => (
    <AiPromptInput {...args}>
      <AiPromptInputHeader removeLabel={(file) => `Remove ${file.name}`} />
      <AiPromptInputTextarea
        aria-label="Message"
        placeholder="Ask the agent to change your code..."
      />
      <AiPromptInputFooter>
        <AiPromptInputTools>
          <AiPromptInputAttachButton label="Attach files" />
        </AiPromptInputTools>
        <AiPromptInputSubmit
          label="Send"
          stopLabel="Stop"
          onStop={args.status === "streaming" ? fn() : undefined}
        />
      </AiPromptInputFooter>
    </AiPromptInput>
  ),
} satisfies Meta<typeof AiPromptInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const send = canvas.getByRole("button", { name: "Send" });
    await expect(send).toBeDisabled();
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Message" }),
      "Hi{Enter}",
    );
    await expect(args.onSubmit).toHaveBeenCalledWith({ text: "Hi", files: [] });
  },
};

export const Submitted: Story = { args: { status: "submitted" } };

export const Streaming: Story = { args: { status: "streaming" } };

export const ErrorState: Story = { args: { status: "error" } };

function WithModelSelector() {
  const [model, setModel] = useState("fast");
  const names: Record<string, string> = { fast: "Fast", deep: "Deep" };
  return (
    <AiPromptInput onSubmit={fn()} className="max-w-lg">
      <AiPromptInputTextarea aria-label="Message" placeholder="Ask..." />
      <AiPromptInputFooter>
        <AiPromptInputTools>
          <AiPromptInputAttachButton label="Attach files" />
          <AiModelSelector>
            <AiModelSelectorTrigger aria-label={`Model: ${names[model]}`}>
              {names[model]}
            </AiModelSelectorTrigger>
            <AiModelSelectorContent side="top">
              <AiModelSelectorList value={model} onValueChange={setModel}>
                <AiModelSelectorItem value="fast">Fast</AiModelSelectorItem>
                <AiModelSelectorItem value="deep">Deep</AiModelSelectorItem>
              </AiModelSelectorList>
            </AiModelSelectorContent>
          </AiModelSelector>
        </AiPromptInputTools>
        <AiPromptInputSubmit label="Send" />
      </AiPromptInputFooter>
    </AiPromptInput>
  );
}

export const ModelSelector: Story = { render: () => <WithModelSelector /> };

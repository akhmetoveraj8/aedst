import { AiChat02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import {
  AiChat,
  AiChatContent,
  AiChatEmptyState,
  AiChatItem,
  AiChatScrollButton,
} from "@/shared/ui/ai-chat";
import {
  AiMessage,
  AiMessageContent,
  AiMessageResponse,
} from "@/shared/ui/ai-message";
import {
  AiPromptInput,
  AiPromptInputFooter,
  type AiPromptInputMessage,
  AiPromptInputSubmit,
  AiPromptInputTextarea,
} from "@/shared/ui/ai-prompt-input";

type Turn = { id: string; from: "user" | "assistant"; text: string };

const TURNS: Turn[] = Array.from({ length: 6 }, (_, i) => [
  {
    id: `u${i}`,
    from: "user" as const,
    text: `Question ${i + 1}: what changed in step ${i + 1}?`,
  },
  {
    id: `a${i}`,
    from: "assistant" as const,
    text: `Step ${i + 1} moved the settings form into a dialog and added a test for the empty state.`,
  },
]).flat();

function Thread({ turns }: { turns: Turn[] }) {
  return (
    <AiChat>
      <AiChatContent>
        {turns.map((turn) => (
          <AiChatItem key={turn.id} messageId={turn.id} from={turn.from}>
            <AiMessage from={turn.from}>
              <AiMessageContent>
                {turn.from === "user" ? (
                  turn.text
                ) : (
                  <AiMessageResponse>{turn.text}</AiMessageResponse>
                )}
              </AiMessageContent>
            </AiMessage>
          </AiChatItem>
        ))}
      </AiChatContent>
      <AiChatScrollButton label="Scroll to latest message" />
    </AiChat>
  );
}

const meta = {
  title: "UI/AI/Chat",
  component: AiChat,
} satisfies Meta<typeof AiChat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex h-96 max-w-lg flex-col rounded-lg border">
      <Thread turns={TURNS} />
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <div className="flex h-72 max-w-lg flex-col rounded-lg border">
      <AiChatEmptyState
        icon={<HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} />}
        title="What should we build?"
        description="The agent can read your code, run commands and make changes."
      />
    </div>
  ),
};

function InteractiveChat() {
  const [turns, setTurns] = useState<Turn[]>(TURNS.slice(0, 2));
  const send = ({ text }: AiPromptInputMessage) => {
    const n = turns.length;
    setTurns([
      ...turns,
      { id: `u-${n}`, from: "user", text },
      { id: `a-${n}`, from: "assistant", text: `You said: ${text}` },
    ]);
  };
  return (
    <div className="flex h-112 max-w-lg flex-col gap-3 rounded-lg border p-3">
      <Thread turns={turns} />
      <AiPromptInput onSubmit={send}>
        <AiPromptInputTextarea
          aria-label="Message"
          placeholder="Ask the agent..."
        />
        <AiPromptInputFooter>
          <AiPromptInputSubmit label="Send" />
        </AiPromptInputFooter>
      </AiPromptInput>
    </div>
  );
}

export const WithPromptInput: Story = { render: () => <InteractiveChat /> };

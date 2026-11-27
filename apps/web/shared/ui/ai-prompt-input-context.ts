import * as React from "react";
import type { usePromptDraft } from "@/shared/lib/hooks/use-prompt-draft";

// Shared state of `ai-prompt-input.tsx` (kept apart for file size).

type AiPromptInputStatus = "ready" | "submitted" | "streaming" | "error";

type AiPromptInputValue = ReturnType<typeof usePromptDraft> & {
  status: AiPromptInputStatus;
};

const AiPromptInputContext = React.createContext<AiPromptInputValue | null>(
  null,
);

function useAiPromptInput(): AiPromptInputValue {
  const value = React.useContext(AiPromptInputContext);
  if (!value) {
    throw new Error("AiPromptInput parts must be used inside <AiPromptInput>");
  }
  return value;
}

export {
  AiPromptInputContext,
  type AiPromptInputStatus,
  type AiPromptInputValue,
  useAiPromptInput,
};

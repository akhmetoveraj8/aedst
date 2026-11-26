"use client";

import { AiBrain01Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import * as React from "react";

import {
  AiChainOfThought,
  AiChainOfThoughtContent,
  AiChainOfThoughtHeader,
} from "@/shared/ui/ai-chain-of-thought";

interface AiReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
}

const AiReasoningContext = React.createContext<AiReasoningContextValue | null>(
  null,
);

function useAiReasoning(): AiReasoningContextValue {
  const context = React.use(AiReasoningContext);
  if (!context) {
    throw new Error("useAiReasoning must be used inside <AiReasoning>");
  }
  return context;
}

interface AiReasoningProps
  extends Omit<React.ComponentProps<"div">, "onChange"> {
  /** The model is still thinking: the panel opens and the line shows a spinner. */
  isStreaming?: boolean;
  /** Controlled open state; wins over the streaming behaviour. */
  open?: boolean;
  /** Initial user choice; without it the panel follows `isStreaming`. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Model reasoning as one collapsible line. It opens while the model thinks
 * and closes when it finishes, unless the user opened or closed it.
 */
function AiReasoning({
  isStreaming = false,
  open,
  defaultOpen,
  onOpenChange,
  className,
  ...props
}: AiReasoningProps) {
  const [userOpen, setUserOpen] = React.useState<boolean | undefined>(
    defaultOpen,
  );
  const isOpen = open ?? userOpen ?? isStreaming;
  const context = React.useMemo(
    () => ({ isStreaming, isOpen }),
    [isStreaming, isOpen],
  );

  function handleOpenChange(next: boolean) {
    setUserOpen(next);
    onOpenChange?.(next);
  }

  return (
    <AiReasoningContext value={context}>
      <AiChainOfThought
        data-slot="ai-reasoning"
        data-streaming={isStreaming}
        open={isOpen}
        onOpenChange={handleOpenChange}
        className={className}
        {...props}
      />
    </AiReasoningContext>
  );
}

interface AiReasoningTriggerProps
  extends Omit<
    React.ComponentProps<typeof AiChainOfThoughtHeader>,
    "children" | "status"
  > {
  /** Title while streaming, e.g. "Thinking". */
  thinkingLabel: string;
  /** Title once finished, e.g. "Thought for 5 s" (the caller formats the duration). */
  thoughtLabel: string;
  icon?: IconSvgElement;
}

/** Title line; a polite live region announces the switch from thinking to done. */
function AiReasoningTrigger({
  thinkingLabel,
  thoughtLabel,
  icon = AiBrain01Icon,
  ...props
}: AiReasoningTriggerProps) {
  const { isStreaming } = useAiReasoning();
  const title = isStreaming ? thinkingLabel : thoughtLabel;
  return (
    <>
      <AiChainOfThoughtHeader
        data-slot="ai-reasoning-trigger"
        icon={icon}
        status={isStreaming ? "running" : undefined}
        {...props}
      >
        {title}
      </AiChainOfThoughtHeader>
      <span role="status" aria-live="polite" className="sr-only">
        {title}
      </span>
    </>
  );
}

/** The reasoning text; line breaks are kept. Markdown rendering is the caller's. */
function AiReasoningContent({
  className,
  ...props
}: React.ComponentProps<typeof AiChainOfThoughtContent>) {
  return (
    <AiChainOfThoughtContent
      data-slot="ai-reasoning-content"
      className={cn(
        "text-start whitespace-pre-wrap text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  AiReasoning,
  AiReasoningContent,
  type AiReasoningProps,
  AiReasoningTrigger,
  type AiReasoningTriggerProps,
  useAiReasoning,
};

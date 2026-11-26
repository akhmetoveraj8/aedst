"use client";

import { cn } from "cn";
import * as React from "react";
import { Bubble, BubbleContent } from "@/shared/ui/bubble";
import { Button } from "@/shared/ui/button";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/shared/ui/message";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

// One turn of a conversation with an agent (shadcn AI Elements "Message",
// Base UI pattern). It composes the base `message` and `bubble` kit parts:
// the person's turn is a muted bubble aligned to the end, the agent's turn is
// free text (usually markdown) with actions under it.

type AiMessageRole = "user" | "assistant" | "system";

const AiMessageRoleContext = React.createContext<AiMessageRole>("assistant");

function AiMessage({
  from,
  className,
  ...props
}: React.ComponentProps<"div"> & { from: AiMessageRole }) {
  return (
    <AiMessageRoleContext.Provider value={from}>
      <Message
        data-from={from}
        align={from === "user" ? "end" : "start"}
        className={className}
        {...props}
      />
    </AiMessageRoleContext.Provider>
  );
}

function AiMessageHeader(props: React.ComponentProps<"div">) {
  return <MessageHeader {...props} />;
}

/** The body of a turn. On the person's turn the children sit in a muted bubble. */
function AiMessageContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const from = React.useContext(AiMessageRoleContext);
  return (
    <MessageContent
      className={cn(from === "user" ? undefined : "gap-2", className)}
      {...props}
    >
      {from === "user" ? (
        <Bubble align="end" variant="muted">
          <BubbleContent className="whitespace-pre-wrap">
            {children}
          </BubbleContent>
        </Bubble>
      ) : (
        children
      )}
    </MessageContent>
  );
}

type AiMessageResponseProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** The reply text, usually markdown, possibly still streaming. */
  children: string;
  /** True while the reply streams; exposed as `aria-busy`. */
  streaming?: boolean;
  /**
   * Render slot for markdown. The kit ships no markdown renderer (no new
   * dependency); without this the text renders as plain pre-wrapped text.
   */
  renderMarkdown?: (markdown: string) => React.ReactNode;
};

/** The agent's reply. Pass `renderMarkdown` to render the text as markdown. */
const AiMessageResponse = React.memo(function AiMessageResponse({
  children,
  streaming = false,
  renderMarkdown,
  className,
  ...props
}: AiMessageResponseProps) {
  return (
    <div
      data-slot="ai-message-response"
      data-streaming={streaming || undefined}
      aria-busy={streaming || undefined}
      className={cn(
        "min-w-0 text-sm leading-relaxed wrap-break-word",
        renderMarkdown ? undefined : "whitespace-pre-wrap",
        className,
      )}
      {...props}
    >
      {renderMarkdown ? renderMarkdown(children) : children}
    </div>
  );
});

/** Row of actions under a turn; follows the message alignment. */
function AiMessageActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <MessageFooter className={cn("gap-1 px-0", className)} {...props} />;
}

type AiMessageActionProps = Omit<
  React.ComponentProps<typeof Button>,
  "aria-label"
> & {
  /** Accessible name of the icon button, also shown in its tooltip. */
  label: string;
  /** Tooltip text when it should differ from `label`; `false` hides the tooltip. */
  tooltip?: React.ReactNode | false;
};

/** A ghost icon button with a tooltip. Set `aria-pressed` for toggles. */
function AiMessageAction({
  label,
  tooltip,
  variant = "ghost",
  size = "icon-sm",
  className,
  ...props
}: AiMessageActionProps) {
  const button = (
    <Button
      variant={variant}
      size={size}
      aria-label={label}
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
  if (tooltip === false) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}

export {
  AiMessage,
  AiMessageAction,
  AiMessageActions,
  AiMessageContent,
  AiMessageHeader,
  AiMessageResponse,
  type AiMessageRole,
};

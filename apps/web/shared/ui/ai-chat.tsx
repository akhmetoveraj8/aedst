"use client";

import { ArrowDown02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import type * as React from "react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/ui/empty";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/shared/ui/message-scroller";

// The thread of a conversation with an agent (shadcn AI Elements "Chat",
// Base UI pattern; "Conversation" in AI SDK Elements). It composes the base
// `message-scroller`: the person's turn is the scroll anchor, so a new
// question settles near the top and the reply streams in under it.

type AiChatProps = React.ComponentProps<typeof MessageScroller> &
  Pick<
    React.ComponentProps<typeof MessageScrollerProvider>,
    "autoScroll" | "defaultScrollPosition"
  >;

/** Scroll container of the thread. `autoScroll` follows the reply at the live edge. */
function AiChat({
  autoScroll = true,
  defaultScrollPosition,
  className,
  ...props
}: AiChatProps) {
  return (
    <MessageScrollerProvider
      autoScroll={autoScroll}
      defaultScrollPosition={defaultScrollPosition}
    >
      <MessageScroller className={cn("min-h-0 flex-1", className)} {...props} />
    </MessageScrollerProvider>
  );
}

type AiChatContentProps = React.ComponentProps<
  typeof MessageScrollerContent
> & {
  /** True while a reply is submitted or streaming; exposed as `aria-busy`. */
  busy?: boolean;
  viewportClassName?: string;
};

/**
 * The scrolling list of turns. It is a `log` live region; `aria-busy` holds
 * announcements back while a reply streams, so a screen reader reads the
 * finished turn once instead of every token.
 */
function AiChatContent({
  busy = false,
  viewportClassName,
  className,
  ...props
}: AiChatContentProps) {
  return (
    <MessageScrollerViewport className={viewportClassName}>
      <MessageScrollerContent
        role="log"
        aria-busy={busy}
        className={cn("gap-6 px-4 py-4", className)}
        {...props}
      />
    </MessageScrollerViewport>
  );
}

type AiChatItemProps = Omit<
  React.ComponentProps<typeof MessageScrollerItem>,
  "scrollAnchor"
> & {
  messageId: string;
  /** The person's turns are scroll anchors and slide in (unless motion is reduced). */
  from: "user" | "assistant" | "system";
};

/** One turn in the thread; wrap an `AiMessage` in it. */
function AiChatItem({ from, className, ...props }: AiChatItemProps) {
  const isUser = from === "user";
  return (
    <MessageScrollerItem
      scrollAnchor={isUser}
      data-from={from}
      className={cn(
        isUser &&
          "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200",
        className,
      )}
      {...props}
    />
  );
}

type AiChatScrollButtonProps = Omit<
  React.ComponentProps<typeof MessageScrollerButton>,
  "children"
> & {
  /** Accessible name, e.g. "Scroll to latest message". */
  label: string;
};

/** Floating button that jumps back to the live edge; hidden while there. */
function AiChatScrollButton({ label, ...props }: AiChatScrollButtonProps) {
  return (
    <MessageScrollerButton {...props}>
      <HugeiconsIcon icon={ArrowDown02Icon} strokeWidth={2} />
      <span className="sr-only">{label}</span>
    </MessageScrollerButton>
  );
}

type AiChatEmptyStateProps = Omit<React.ComponentProps<"div">, "title"> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
};

/** Shown instead of the thread before the first turn. */
function AiChatEmptyState({
  title,
  description,
  icon,
  className,
  children,
  ...props
}: AiChatEmptyStateProps) {
  return (
    <Empty className={cn("size-full", className)} {...props}>
      {children ?? (
        <EmptyHeader>
          {icon ? <EmptyMedia variant="icon">{icon}</EmptyMedia> : null}
          {title ? <EmptyTitle>{title}</EmptyTitle> : null}
          {description ? (
            <EmptyDescription>{description}</EmptyDescription>
          ) : null}
        </EmptyHeader>
      )}
    </Empty>
  );
}

export {
  AiChat,
  AiChatContent,
  AiChatEmptyState,
  AiChatItem,
  AiChatScrollButton,
};

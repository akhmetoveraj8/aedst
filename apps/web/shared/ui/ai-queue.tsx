"use client";

import { CheckListIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import type * as React from "react";

import {
  AiChainOfThought,
  AiChainOfThoughtContent,
  AiChainOfThoughtHeader,
  AiChainOfThoughtStep,
  AiChainOfThoughtSteps,
} from "@/shared/ui/ai-chain-of-thought";
import { Button } from "@/shared/ui/button";
import type { TraceStatus } from "@/shared/ui/trace";

/** The agent's todo list, grouped in sections such as "To do" and "Completed". */
function AiQueue({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-queue"
      className={cn("flex w-full flex-col gap-1 text-sm", className)}
      {...props}
    />
  );
}

/** A collapsible group of todos; open by default. */
function AiQueueSection({
  defaultOpen = true,
  ...props
}: React.ComponentProps<typeof AiChainOfThought>) {
  return (
    <AiChainOfThought
      data-slot="ai-queue-section"
      defaultOpen={defaultOpen}
      {...props}
    />
  );
}

interface AiQueueSectionTriggerProps
  extends Omit<
    React.ComponentProps<typeof AiChainOfThoughtHeader>,
    "children"
  > {
  /** "2 to do", "Completed" (the caller pluralises). */
  label: string;
  icon?: IconSvgElement;
}

function AiQueueSectionTrigger({
  label,
  icon = CheckListIcon,
  ...props
}: AiQueueSectionTriggerProps) {
  return (
    <AiChainOfThoughtHeader
      data-slot="ai-queue-section-trigger"
      icon={icon}
      {...props}
    >
      {label}
    </AiChainOfThoughtHeader>
  );
}

function AiQueueSectionContent(
  props: React.ComponentProps<typeof AiChainOfThoughtContent>,
) {
  return (
    <AiChainOfThoughtContent data-slot="ai-queue-section-content" {...props} />
  );
}

function AiQueueList(
  props: React.ComponentProps<typeof AiChainOfThoughtSteps>,
) {
  return <AiChainOfThoughtSteps data-slot="ai-queue-list" {...props} />;
}

/** Todo state (the agent's `writeTodos` vocabulary). */
type AiQueueItemStatus = "pending" | "in-progress" | "completed";

const ITEM_STATUS: Record<AiQueueItemStatus, TraceStatus> = {
  pending: "pending",
  "in-progress": "running",
  completed: "success",
};

interface AiQueueItemProps
  extends Omit<React.ComponentProps<typeof AiChainOfThoughtStep>, "status"> {
  status?: AiQueueItemStatus;
}

/** One todo: an icon per state, completed ones struck through; actions go in `children`. */
function AiQueueItem({
  status = "pending",
  label,
  className,
  ...props
}: AiQueueItemProps) {
  return (
    <AiChainOfThoughtStep
      data-slot="ai-queue-item"
      data-state={status}
      status={ITEM_STATUS[status]}
      label={
        status === "completed" ? (
          <span className="text-muted-foreground line-through">{label}</span>
        ) : (
          label
        )
      }
      className={cn("group/ai-queue-item rounded-md hover:bg-muted", className)}
      {...props}
    />
  );
}

/** Buttons for one todo, revealed on hover or keyboard focus (always shown on touch). */
function AiQueueItemActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-queue-item-actions"
      className={cn(
        "flex items-center gap-1 pointer-fine:opacity-0 pointer-fine:group-focus-within/ai-queue-item:opacity-100 pointer-fine:group-hover/ai-queue-item:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

interface AiQueueItemActionProps
  extends Omit<React.ComponentProps<typeof Button>, "children"> {
  /** Accessible name (the button shows only the icon). */
  label: string;
  icon: IconSvgElement;
}

function AiQueueItemAction({
  label,
  icon,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: AiQueueItemActionProps) {
  return (
    <Button
      data-slot="ai-queue-item-action"
      variant={variant}
      size={size}
      aria-label={label}
      {...props}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} aria-hidden="true" />
    </Button>
  );
}

export {
  AiQueue,
  AiQueueItem,
  AiQueueItemAction,
  type AiQueueItemActionProps,
  AiQueueItemActions,
  type AiQueueItemProps,
  type AiQueueItemStatus,
  AiQueueList,
  AiQueueSection,
  AiQueueSectionContent,
  AiQueueSectionTrigger,
  type AiQueueSectionTriggerProps,
};

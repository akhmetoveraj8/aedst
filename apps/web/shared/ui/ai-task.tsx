"use client";

import { File01Icon } from "@hugeicons/core-free-icons";
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

/**
 * One unit of agent work whose steps appear as the agent takes them (no
 * pending steps). Several tasks can be stacked; keep the running one open.
 */
function AiTask({
  defaultOpen = true,
  ...props
}: React.ComponentProps<typeof AiChainOfThought>) {
  return (
    <AiChainOfThought
      data-slot="ai-task"
      defaultOpen={defaultOpen}
      {...props}
    />
  );
}

interface AiTaskTriggerProps
  extends Omit<
    React.ComponentProps<typeof AiChainOfThoughtHeader>,
    "children"
  > {
  /** Present tense while running ("Searching..."), past tense when done ("Found..."). */
  title: string;
  icon?: IconSvgElement;
}

function AiTaskTrigger({ title, ...props }: AiTaskTriggerProps) {
  return (
    <AiChainOfThoughtHeader data-slot="ai-task-trigger" {...props}>
      {title}
    </AiChainOfThoughtHeader>
  );
}

/** Steps panel; kept mounted so nested open state survives collapsing. */
function AiTaskContent({
  keepMounted = true,
  children,
  ...props
}: React.ComponentProps<typeof AiChainOfThoughtContent>) {
  return (
    <AiChainOfThoughtContent
      data-slot="ai-task-content"
      keepMounted={keepMounted}
      {...props}
    >
      <AiChainOfThoughtSteps>{children}</AiChainOfThoughtSteps>
    </AiChainOfThoughtContent>
  );
}

/** One step the agent took: `status` running, error, or unset when done. */
function AiTaskItem(props: React.ComponentProps<typeof AiChainOfThoughtStep>) {
  return <AiChainOfThoughtStep data-slot="ai-task-item" {...props} />;
}

interface AiTaskItemFileProps extends React.ComponentProps<"span"> {
  icon?: IconSvgElement;
}

/** File chip inside a step label; paths stay left-to-right in RTL. */
function AiTaskItemFile({
  icon = File01Icon,
  className,
  children,
  ...props
}: AiTaskItemFileProps) {
  return (
    <span
      data-slot="ai-task-item-file"
      dir="ltr"
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border bg-secondary px-1.5 py-0.5 align-middle font-mono text-xs text-secondary-foreground",
        className,
      )}
      {...props}
    >
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        aria-hidden="true"
        className="size-3 shrink-0"
      />
      <span className="truncate">{children}</span>
    </span>
  );
}

export {
  AiTask,
  AiTaskContent,
  AiTaskItem,
  AiTaskItemFile,
  type AiTaskItemFileProps,
  AiTaskTrigger,
  type AiTaskTriggerProps,
};

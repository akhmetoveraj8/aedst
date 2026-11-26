"use client";

import { BotIcon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import type * as React from "react";

import {
  AiChainOfThought,
  AiChainOfThoughtContent,
  AiChainOfThoughtHeader,
  AiChainOfThoughtStep,
  AiChainOfThoughtSteps,
} from "@/shared/ui/ai-chain-of-thought";
import { Badge } from "@/shared/ui/badge";

/** A delegated agent run: its task, model and tools, then its own tool calls. */
function AiSubagent(props: React.ComponentProps<typeof AiChainOfThought>) {
  return <AiChainOfThought data-slot="ai-subagent" {...props} />;
}

interface AiSubagentTriggerProps
  extends Omit<
    React.ComponentProps<typeof AiChainOfThoughtHeader>,
    "children"
  > {
  /** "Running the research agent" while it works, "Ran the research agent" when done. */
  title: string;
  icon?: IconSvgElement;
}

/** `status` is running while the subagent works and error on failure; `description` holds the duration. */
function AiSubagentTrigger({
  title,
  icon = BotIcon,
  ...props
}: AiSubagentTriggerProps) {
  return (
    <AiChainOfThoughtHeader
      data-slot="ai-subagent-trigger"
      icon={icon}
      {...props}
    >
      {title}
    </AiChainOfThoughtHeader>
  );
}

/** Kept mounted so the nested tool calls keep their open state. */
function AiSubagentContent({
  keepMounted = true,
  ...props
}: React.ComponentProps<typeof AiChainOfThoughtContent>) {
  return (
    <AiChainOfThoughtContent
      data-slot="ai-subagent-content"
      keepMounted={keepMounted}
      {...props}
    />
  );
}

/** The instruction the parent agent gave. */
function AiSubagentTask({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="ai-subagent-task"
      className={cn("px-2 text-pretty text-foreground", className)}
      {...props}
    />
  );
}

/** Model and tools as labelled badge rows (a description list). */
function AiSubagentMeta({ className, ...props }: React.ComponentProps<"dl">) {
  return (
    <dl
      data-slot="ai-subagent-meta"
      className={cn(
        "grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 px-2",
        className,
      )}
      {...props}
    />
  );
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap gap-1">{children}</dd>
    </>
  );
}

interface AiSubagentModelProps {
  /** Visible term, e.g. "Model". */
  label: string;
  /** Model id, kept left-to-right. */
  model: string;
}

function AiSubagentModel({ label, model }: AiSubagentModelProps) {
  return (
    <MetaRow label={label}>
      <Badge data-slot="ai-subagent-model" variant="outline" dir="ltr">
        {model}
      </Badge>
    </MetaRow>
  );
}

interface AiSubagentToolsProps {
  /** Visible term, e.g. "Tools". */
  label: string;
  tools: readonly string[];
}

function AiSubagentTools({ label, tools }: AiSubagentToolsProps) {
  return (
    <MetaRow label={label}>
      {tools.map((tool) => (
        <Badge
          key={tool}
          data-slot="ai-subagent-tool"
          variant="secondary"
          dir="ltr"
        >
          {tool}
        </Badge>
      ))}
    </MetaRow>
  );
}

function AiSubagentSteps(
  props: React.ComponentProps<typeof AiChainOfThoughtSteps>,
) {
  return <AiChainOfThoughtSteps data-slot="ai-subagent-steps" {...props} />;
}

/** One tool call the subagent made. */
function AiSubagentStep(
  props: React.ComponentProps<typeof AiChainOfThoughtStep>,
) {
  return <AiChainOfThoughtStep data-slot="ai-subagent-step" {...props} />;
}

export {
  AiSubagent,
  AiSubagentContent,
  AiSubagentMeta,
  AiSubagentModel,
  type AiSubagentModelProps,
  AiSubagentStep,
  AiSubagentSteps,
  AiSubagentTask,
  AiSubagentTools,
  type AiSubagentToolsProps,
  AiSubagentTrigger,
  type AiSubagentTriggerProps,
};

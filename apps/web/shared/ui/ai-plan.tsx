"use client";

import { Route01Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import * as React from "react";

import {
  AiChainOfThought,
  AiChainOfThoughtContent,
  AiChainOfThoughtHeader,
  AiChainOfThoughtStep,
  AiChainOfThoughtSteps,
} from "@/shared/ui/ai-chain-of-thought";

const AiPlanContext = React.createContext<{ isStreaming: boolean }>({
  isStreaming: false,
});

interface AiPlanProps extends React.ComponentProps<typeof AiChainOfThought> {
  /** The plan is still being written: the title line shows a spinner. */
  isStreaming?: boolean;
}

/**
 * Every step of the agent's plan, known up front (pending ones included).
 * Use `AiTask` instead when the steps appear as the agent takes them.
 */
function AiPlan({
  isStreaming = false,
  defaultOpen = true,
  ...props
}: AiPlanProps) {
  const context = React.useMemo(() => ({ isStreaming }), [isStreaming]);
  return (
    <AiPlanContext value={context}>
      <AiChainOfThought
        data-slot="ai-plan"
        data-streaming={isStreaming}
        defaultOpen={defaultOpen}
        {...props}
      />
    </AiPlanContext>
  );
}

/** Row holding the trigger and, beside it, `AiPlanAction` (a button cannot sit inside a button). */
function AiPlanHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-plan-header"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  );
}

interface AiPlanTriggerProps
  extends Omit<React.ComponentProps<typeof AiChainOfThoughtHeader>, "status"> {
  icon?: IconSvgElement;
}

/** The plan title line; `description` carries progress such as "2 of 5 done". */
function AiPlanTrigger({ icon = Route01Icon, ...props }: AiPlanTriggerProps) {
  const { isStreaming } = React.use(AiPlanContext);
  return (
    <AiChainOfThoughtHeader
      data-slot="ai-plan-trigger"
      icon={icon}
      status={isStreaming ? "running" : undefined}
      {...props}
    />
  );
}

function AiPlanAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-plan-action"
      className={cn("flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  );
}

function AiPlanContent(
  props: React.ComponentProps<typeof AiChainOfThoughtContent>,
) {
  return <AiChainOfThoughtContent data-slot="ai-plan-content" {...props} />;
}

/** Summary above the steps. */
function AiPlanDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="ai-plan-description"
      className={cn("px-2 text-pretty text-muted-foreground", className)}
      {...props}
    />
  );
}

function AiPlanSteps(
  props: React.ComponentProps<typeof AiChainOfThoughtSteps>,
) {
  return <AiChainOfThoughtSteps data-slot="ai-plan-steps" {...props} />;
}

/** One step: `status` pending, running (current), success (done), error or skipped. */
function AiPlanStep(props: React.ComponentProps<typeof AiChainOfThoughtStep>) {
  return <AiChainOfThoughtStep data-slot="ai-plan-step" {...props} />;
}

function AiPlanFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-plan-footer"
      className={cn("flex items-center gap-2 px-2 pt-1", className)}
      {...props}
    />
  );
}

export {
  AiPlan,
  AiPlanAction,
  AiPlanContent,
  AiPlanDescription,
  AiPlanFooter,
  AiPlanHeader,
  type AiPlanProps,
  AiPlanStep,
  AiPlanSteps,
  AiPlanTrigger,
  type AiPlanTriggerProps,
};

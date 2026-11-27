"use client";

import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  CircleIcon,
  Loading03Icon,
  MinusSignCircleIcon,
  MultiplicationSignCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cva } from "class-variance-authority";
import { cn } from "cn";
import * as React from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";

type TraceStatus = "pending" | "running" | "success" | "error" | "skipped";

interface TraceStep {
  id: string;
  title: string;
  status: TraceStatus;
  /** Already formatted by the caller, e.g. "1.2 s". */
  duration?: string;
  /** Extra content (arguments, output) shown when the step is expanded. */
  detail?: React.ReactNode;
  children?: TraceStep[];
  /** Initial open state; running and failed steps open by default. */
  defaultOpen?: boolean;
}

/** One visible, translated label per status: status is never colour alone. */
type TraceStatusLabels = Record<TraceStatus, string>;

const STATUS_ICON = {
  pending: CircleIcon,
  running: Loading03Icon,
  success: CheckmarkCircle02Icon,
  error: MultiplicationSignCircleIcon,
  skipped: MinusSignCircleIcon,
} as const;

const traceStatusVariants = cva("size-4 shrink-0", {
  variants: {
    status: {
      pending: "text-muted-foreground",
      running: "animate-spin text-info motion-reduce:animate-none",
      success: "text-success",
      error: "text-destructive",
      skipped: "text-muted-foreground",
    },
  },
});

const ROW = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm";

function flatten(steps: TraceStep[]): TraceStep[] {
  return steps.flatMap((step) => [step, ...flatten(step.children ?? [])]);
}

/** Text for the live region: only steps whose status changed since the last render. */
function useStatusAnnouncement(steps: TraceStep[], labels: TraceStatusLabels) {
  const [message, setMessage] = React.useState("");
  const previous = React.useRef<Map<string, TraceStatus> | null>(null);

  React.useEffect(() => {
    const all = flatten(steps);
    const before = previous.current;
    previous.current = new Map(all.map((step) => [step.id, step.status]));
    if (!before) {
      return;
    }
    const changed = all.filter(
      (step) => before.has(step.id) && before.get(step.id) !== step.status,
    );
    if (changed.length > 0) {
      setMessage(
        changed.map((s) => `${s.title}: ${labels[s.status]}`).join(". "),
      );
    }
  }, [steps, labels]);

  return message;
}

function TraceStepRow({
  step,
  statusLabels,
}: {
  step: TraceStep;
  statusLabels: TraceStatusLabels;
}) {
  return (
    <>
      <HugeiconsIcon
        icon={STATUS_ICON[step.status]}
        strokeWidth={2}
        aria-hidden="true"
        className={traceStatusVariants({ status: step.status })}
      />
      <span className="min-w-0 flex-1 truncate text-start font-medium">
        {step.title}
      </span>
      <span data-slot="trace-status" className="text-xs text-muted-foreground">
        {statusLabels[step.status]}
      </span>
      {step.duration ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {step.duration}
        </span>
      ) : null}
    </>
  );
}

function TraceItem({
  step,
  statusLabels,
}: {
  step: TraceStep;
  statusLabels: TraceStatusLabels;
}) {
  const children = step.children ?? [];
  const expandable = children.length > 0 || step.detail != null;

  if (!expandable) {
    return (
      <li data-slot="trace-step" data-status={step.status}>
        {/* ps-8: aligns with rows that have a chevron. */}
        <div className={cn(ROW, "ps-8")}>
          <TraceStepRow step={step} statusLabels={statusLabels} />
        </div>
      </li>
    );
  }

  return (
    <li data-slot="trace-step" data-status={step.status}>
      <Collapsible
        defaultOpen={
          step.defaultOpen ??
          (step.status === "running" || step.status === "error")
        }
      >
        <CollapsibleTrigger
          className={cn(
            ROW,
            "group/trace-trigger outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring",
          )}
        >
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded/trace-trigger:rotate-90 rtl:rotate-180 rtl:group-aria-expanded/trace-trigger:rotate-90 motion-reduce:transition-none"
          />
          <TraceStepRow step={step} statusLabels={statusLabels} />
        </CollapsibleTrigger>
        <CollapsibleContent className="ms-4 border-s ps-1">
          {step.detail != null ? (
            <div
              data-slot="trace-detail"
              className="px-2 py-1.5 ps-8 text-sm text-muted-foreground"
            >
              {step.detail}
            </div>
          ) : null}
          {children.length > 0 ? (
            <ul className="flex flex-col">
              {children.map((child) => (
                <TraceItem
                  key={child.id}
                  step={child}
                  statusLabels={statusLabels}
                />
              ))}
            </ul>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

interface TraceProps extends Omit<React.ComponentProps<"div">, "children"> {
  steps: TraceStep[];
  statusLabels: TraceStatusLabels;
}

/**
 * Collapsible step tree for agent and tool execution traces. Every step
 * with a detail or children is a disclosure button (Enter/Space, Tab);
 * status is an icon plus a text label; a polite live region announces
 * status changes only (not the initial render, not expanding).
 */
function Trace({ steps, statusLabels, className, ...props }: TraceProps) {
  const announcement = useStatusAnnouncement(steps, statusLabels);

  return (
    <div data-slot="trace" className={cn("w-full", className)} {...props}>
      <ul className="flex flex-col">
        {steps.map((step) => (
          <TraceItem key={step.id} step={step} statusLabels={statusLabels} />
        ))}
      </ul>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

export {
  Trace,
  type TraceProps,
  type TraceStatus,
  type TraceStatusLabels,
  type TraceStep,
  traceStatusVariants,
};

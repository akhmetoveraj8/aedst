"use client";

import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  CircleIcon,
  Loading03Icon,
  MinusSignCircleIcon,
  MultiplicationSignCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import type * as React from "react";

import { Badge } from "@/shared/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";
import { type TraceStatus, traceStatusVariants } from "@/shared/ui/trace";

const STATUS_ICON = {
  pending: CircleIcon,
  running: Loading03Icon,
  success: CheckmarkCircle02Icon,
  error: MultiplicationSignCircleIcon,
  skipped: MinusSignCircleIcon,
} as const;

/**
 * Leading icon of a line. Running and failed lines always show the status
 * icon (spinner, cross); otherwise a caller icon wins over the status icon.
 */
function StatusIcon({
  status,
  icon,
}: {
  status?: TraceStatus;
  icon?: IconSvgElement;
}) {
  const forced = status === "running" || status === "error";
  if (icon && !forced) {
    return (
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    );
  }
  const effective = status ?? "success";
  return (
    <HugeiconsIcon
      icon={STATUS_ICON[effective]}
      strokeWidth={2}
      aria-hidden="true"
      className={traceStatusVariants({ status: effective })}
    />
  );
}

/** Status in words for assistive technology: the icon alone is not enough. */
function StatusText({ label }: { label?: string }) {
  return label ? <span className="sr-only"> {label}</span> : null;
}

type AiChainOfThoughtProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "className"
> & { className?: string };

/** Collapsible reasoning trail: a header line and the steps the agent took. */
function AiChainOfThought({ className, ...props }: AiChainOfThoughtProps) {
  return (
    <Collapsible
      data-slot="ai-chain-of-thought"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  );
}

interface AiChainOfThoughtHeaderProps
  extends Omit<React.ComponentProps<typeof CollapsibleTrigger>, "className"> {
  className?: string;
  /** Leading icon; a running or failed `status` replaces it. */
  icon?: IconSvgElement;
  status?: TraceStatus;
  /** Visually hidden status in words, e.g. "Running". */
  statusLabel?: string;
  /** Short text after the title: a duration, "2 of 5 done". */
  description?: React.ReactNode;
}

/** The whole line is the disclosure button (Enter/Space); the chevron mirrors in RTL. */
function AiChainOfThoughtHeader({
  icon,
  status,
  statusLabel,
  description,
  className,
  children,
  ...props
}: AiChainOfThoughtHeaderProps) {
  return (
    <CollapsibleTrigger
      data-slot="ai-chain-of-thought-header"
      data-status={status}
      className={cn(
        "group/ai-header flex w-full pointer-coarse:min-h-11 items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      {icon || status ? <StatusIcon status={status} icon={icon} /> : null}
      <span className="min-w-0 truncate text-start font-medium">
        {children}
        <StatusText label={statusLabel} />
      </span>
      {description ? (
        <span className="shrink-0 text-xs tabular-nums">{description}</span>
      ) : null}
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        strokeWidth={2}
        aria-hidden="true"
        className="ms-auto size-4 shrink-0 transition-transform group-aria-expanded/ai-header:rotate-90 motion-reduce:transition-none rtl:rotate-180 rtl:group-aria-expanded/ai-header:rotate-90"
      />
    </CollapsibleTrigger>
  );
}

type AiChainOfThoughtContentProps = Omit<
  React.ComponentProps<typeof CollapsibleContent>,
  "className"
> & { className?: string };

/** Indented panel under a header (inline-start rule, mirrored in RTL). */
function AiChainOfThoughtContent({
  className,
  ...props
}: AiChainOfThoughtContentProps) {
  return (
    <CollapsibleContent
      data-slot="ai-chain-of-thought-content"
      className={cn("ms-4 flex flex-col gap-2 border-s ps-3 pt-1", className)}
      {...props}
    />
  );
}

/** The list that holds `AiChainOfThoughtStep`s. */
function AiChainOfThoughtSteps({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="ai-chain-of-thought-steps"
      className={cn("flex flex-col", className)}
      {...props}
    />
  );
}

interface AiChainOfThoughtStepProps
  extends Omit<React.ComponentProps<"li">, "children"> {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Defaults to `success` (done). */
  status?: TraceStatus;
  icon?: IconSvgElement;
  /** Visually hidden status in words. */
  statusLabel?: string;
  /** Extra content under the label: search results, an image, a file. */
  children?: React.ReactNode;
}

function AiChainOfThoughtStep({
  label,
  description,
  status = "success",
  icon,
  statusLabel,
  children,
  className,
  ...props
}: AiChainOfThoughtStepProps) {
  return (
    <li
      data-slot="ai-chain-of-thought-step"
      data-status={status}
      className={cn("flex gap-2 px-2 py-1.5", className)}
      {...props}
    >
      <span className="flex h-5 items-center">
        <StatusIcon status={status} icon={icon} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={cn(
            "text-start",
            status === "pending" || status === "skipped"
              ? "text-muted-foreground"
              : "text-foreground",
          )}
        >
          {label}
          <StatusText label={statusLabel} />
        </span>
        {description ? (
          <span className="text-xs text-muted-foreground">{description}</span>
        ) : null}
        {children}
      </div>
    </li>
  );
}

function AiChainOfThoughtSearchResults({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-chain-of-thought-search-results"
      className={cn("flex flex-wrap items-center gap-1", className)}
      {...props}
    />
  );
}

/** One source the agent looked at; host names stay left-to-right. */
function AiChainOfThoughtSearchResult({
  variant = "secondary",
  ...props
}: React.ComponentProps<typeof Badge>) {
  return (
    <Badge
      data-slot="ai-chain-of-thought-search-result"
      dir="ltr"
      variant={variant}
      {...props}
    />
  );
}

interface AiChainOfThoughtImageProps extends React.ComponentProps<"figure"> {
  /** Caption under the image; the image itself is the caller's `<img>`/`next/image`. */
  caption?: React.ReactNode;
}

function AiChainOfThoughtImage({
  caption,
  className,
  children,
  ...props
}: AiChainOfThoughtImageProps) {
  return (
    <figure
      data-slot="ai-chain-of-thought-image"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    >
      <div className="overflow-hidden rounded-lg bg-muted">{children}</div>
      {caption ? (
        <figcaption className="text-xs text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

export {
  AiChainOfThought,
  AiChainOfThoughtContent,
  AiChainOfThoughtHeader,
  type AiChainOfThoughtHeaderProps,
  AiChainOfThoughtImage,
  type AiChainOfThoughtProps,
  AiChainOfThoughtSearchResult,
  AiChainOfThoughtSearchResults,
  AiChainOfThoughtStep,
  type AiChainOfThoughtStepProps,
  AiChainOfThoughtSteps,
};

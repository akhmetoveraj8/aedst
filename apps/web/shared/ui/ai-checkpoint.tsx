"use client";

import { Bookmark02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import type * as React from "react";

import { Button } from "@/shared/ui/button";
import { Marker, MarkerContent, MarkerIcon } from "@/shared/ui/marker";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

type AiCheckpointProps = Omit<
  React.ComponentProps<typeof Marker>,
  "variant" | "render"
>;

/**
 * A point in the conversation the user can return to: a separator line after
 * a turn with a label and a Restore button. Restoring is the caller's job
 * (keep that turn, drop every later message).
 */
function AiCheckpoint({ className, children, ...props }: AiCheckpointProps) {
  return (
    <Marker
      data-slot="ai-checkpoint"
      variant="separator"
      className={cn("py-1", className)}
      {...props}
    >
      <MarkerContent className="inline-flex items-center gap-2">
        {children}
      </MarkerContent>
    </Marker>
  );
}

interface AiCheckpointIconProps
  extends Omit<React.ComponentProps<typeof MarkerIcon>, "children"> {
  icon?: IconSvgElement;
}

/** Decorative leading icon (a bookmark by default). */
function AiCheckpointIcon({
  icon = Bookmark02Icon,
  ...props
}: AiCheckpointIconProps) {
  return (
    <MarkerIcon data-slot="ai-checkpoint-icon" {...props}>
      <HugeiconsIcon icon={icon} strokeWidth={2} aria-hidden="true" />
    </MarkerIcon>
  );
}

interface AiCheckpointTriggerProps
  extends Omit<React.ComponentProps<typeof Button>, "variant" | "size"> {
  /** Optional hint shown on hover and focus, e.g. "Restore the thread to this point". */
  tooltip?: React.ReactNode;
}

/**
 * The Restore button. Give it an `aria-label` that names the checkpoint
 * ("Restore to Button renamed") when the visible text alone is ambiguous.
 */
function AiCheckpointTrigger({ tooltip, ...props }: AiCheckpointTriggerProps) {
  const button = (
    <Button
      data-slot="ai-checkpoint-trigger"
      variant="outline"
      size="xs"
      {...props}
    />
  );
  if (!tooltip) {
    return button;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export {
  AiCheckpoint,
  AiCheckpointIcon,
  type AiCheckpointIconProps,
  type AiCheckpointProps,
  AiCheckpointTrigger,
  type AiCheckpointTriggerProps,
};

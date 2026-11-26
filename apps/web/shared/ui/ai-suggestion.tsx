"use client";

import { cn } from "cn";
import type * as React from "react";
import { Button } from "@/shared/ui/button";

// A prompt the person sends in one click (shadcn AI Elements "Suggestion",
// Base UI pattern). A row of outline buttons above the prompt input; the row
// scrolls sideways when the suggestions do not fit.

/** Horizontal, scrollable row of suggestions. */
function AiSuggestions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-suggestions"
      role="group"
      className={cn(
        "flex min-w-0 scroll-fade-x scrollbar-none gap-2 overflow-x-auto overscroll-x-contain py-1",
        className,
      )}
      {...props}
    />
  );
}

type AiSuggestionProps = Omit<
  React.ComponentProps<typeof Button>,
  "onClick"
> & {
  /** The prompt text: the button label (unless `children` is set) and the value sent. */
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

/** One suggestion; `onClick` receives the suggestion text. */
function AiSuggestion({
  suggestion,
  onClick,
  variant = "outline",
  size = "sm",
  className,
  children,
  ...props
}: AiSuggestionProps) {
  return (
    <Button
      variant={variant}
      size={size}
      className={cn("shrink-0", className)}
      onClick={() => onClick?.(suggestion)}
      {...props}
    >
      {children ?? suggestion}
    </Button>
  );
}

export { AiSuggestion, AiSuggestions };

"use client";

import { cn } from "cn";
import * as React from "react";
import { useFormatter } from "use-intl";
import { Button } from "@/shared/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/shared/ui/hover-card";
import { Progress } from "@/shared/ui/progress";

// How much of the model's context window the conversation has used (shadcn
// AI Elements "Context", Base UI pattern): a hover card on a small outline
// button, with a progress bar and the token breakdown. Numbers are formatted
// for the active locale (use-intl), compact for token counts.

type AiContextUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

type AiContextValue = {
  usedTokens: number;
  maxTokens: number;
  usage?: AiContextUsage;
  /** Share of the window used, 0..1, clamped. */
  ratio: number;
};

const AiContextContext = React.createContext<AiContextValue | null>(null);

function useAiContext(): AiContextValue {
  const value = React.useContext(AiContextContext);
  if (!value)
    throw new Error("AiContext parts must be used inside <AiContext>");
  return value;
}

type AiContextProps = React.ComponentProps<typeof HoverCard> & {
  usedTokens: number;
  /** The model's context window. The model API rarely sends it; set it per model. */
  maxTokens: number;
  usage?: AiContextUsage;
};

function AiContext({ usedTokens, maxTokens, usage, ...props }: AiContextProps) {
  const value = React.useMemo<AiContextValue>(
    () => ({
      usedTokens,
      maxTokens,
      usage,
      ratio:
        maxTokens > 0 ? Math.min(Math.max(usedTokens / maxTokens, 0), 1) : 0,
    }),
    [usedTokens, maxTokens, usage],
  );
  return (
    <AiContextContext.Provider value={value}>
      <HoverCard {...props} />
    </AiContextContext.Provider>
  );
}

type AiContextTriggerProps = Omit<
  React.ComponentProps<typeof HoverCardTrigger>,
  "render"
> & {
  /** Accessible name read before the percentage, e.g. "Context used". */
  label: string;
};

/** Small outline button showing the percentage used; children replace the percentage. */
function AiContextTrigger({
  label,
  delay = 10,
  closeDelay = 100,
  className,
  children,
  ...props
}: AiContextTriggerProps) {
  const { ratio } = useAiContext();
  const format = useFormatter();
  const percent = format.number(ratio, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  return (
    <HoverCardTrigger
      delay={delay}
      closeDelay={closeDelay}
      render={<Button variant="outline" size="sm" />}
      className={cn("tabular-nums", className)}
      {...props}
    >
      <span className="sr-only">{label}: </span>
      {children ?? percent}
    </HoverCardTrigger>
  );
}

function AiContextContent({
  className,
  ...props
}: React.ComponentProps<typeof HoverCardContent>) {
  return (
    <HoverCardContent
      className={cn("flex w-64 flex-col gap-0 divide-y p-0", className)}
      {...props}
    />
  );
}

function useTokenFormat() {
  const format = useFormatter();
  return (value: number) =>
    format.number(value, { notation: "compact", maximumFractionDigits: 1 });
}

type AiContextContentHeaderProps = React.ComponentProps<"div"> & {
  /** Heading and the progress bar's accessible name, e.g. "Context". */
  label: string;
};

/** Heading, used / max tokens and the progress bar. */
function AiContextContentHeader({
  label,
  className,
  ...props
}: AiContextContentHeaderProps) {
  const { usedTokens, maxTokens, ratio } = useAiContext();
  const formatTokens = useTokenFormat();
  return (
    <div
      data-slot="ai-context-content-header"
      className={cn("flex flex-col gap-2 p-3", className)}
      {...props}
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {formatTokens(usedTokens)} / {formatTokens(maxTokens)}
        </span>
      </div>
      <Progress value={Math.round(ratio * 100)} aria-label={label} />
    </div>
  );
}

function AiContextContentBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-context-content-body"
      className={cn("flex flex-col gap-1 p-3 text-sm", className)}
      {...props}
    />
  );
}

function AiContextContentFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-context-content-footer"
      className={cn(
        "flex items-center justify-between gap-3 rounded-b-lg bg-secondary p-3 text-xs text-secondary-foreground",
        className,
      )}
      {...props}
    />
  );
}

type AiContextUsageRowProps = Omit<React.ComponentProps<"div">, "children"> & {
  label: string;
};

function UsageRow({
  tokens,
  label,
  className,
  ...props
}: AiContextUsageRowProps & { tokens: keyof AiContextUsage }) {
  const { usage } = useAiContext();
  const formatTokens = useTokenFormat();
  const value = usage?.[tokens];
  if (value === undefined) return null;
  return (
    <div className={cn("flex justify-between gap-3", className)} {...props}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatTokens(value)}</span>
    </div>
  );
}

// Breakdown rows; each renders nothing when `usage` lacks its count.
function AiContextInputUsage(props: AiContextUsageRowProps) {
  return (
    <UsageRow
      data-slot="ai-context-input-usage"
      tokens="inputTokens"
      {...props}
    />
  );
}

function AiContextOutputUsage(props: AiContextUsageRowProps) {
  return (
    <UsageRow
      data-slot="ai-context-output-usage"
      tokens="outputTokens"
      {...props}
    />
  );
}

function AiContextReasoningUsage(props: AiContextUsageRowProps) {
  return (
    <UsageRow
      data-slot="ai-context-reasoning-usage"
      tokens="reasoningTokens"
      {...props}
    />
  );
}

function AiContextCacheUsage(props: AiContextUsageRowProps) {
  return (
    <UsageRow
      data-slot="ai-context-cache-usage"
      tokens="cachedInputTokens"
      {...props}
    />
  );
}

export {
  AiContext,
  AiContextCacheUsage,
  AiContextContent,
  AiContextContentBody,
  AiContextContentFooter,
  AiContextContentHeader,
  AiContextInputUsage,
  AiContextOutputUsage,
  AiContextReasoningUsage,
  AiContextTrigger,
  type AiContextUsage,
};

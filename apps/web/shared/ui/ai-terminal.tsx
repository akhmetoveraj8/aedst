"use client";

import {
  ComputerTerminal01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import * as React from "react";

import {
  AiChainOfThought,
  AiChainOfThoughtContent,
  AiChainOfThoughtHeader,
  type AiChainOfThoughtHeaderProps,
  type AiChainOfThoughtProps,
} from "@/shared/ui/ai-chain-of-thought";
import { Button } from "@/shared/ui/button";
import { CodeBlock } from "@/shared/ui/code-block";

interface TerminalState {
  output: string;
  isStreaming: boolean;
  autoScroll: boolean;
  onClear: (() => void) | undefined;
}

const TerminalContext = React.createContext<TerminalState | null>(null);

function useTerminal(part: string): TerminalState {
  const state = React.use(TerminalContext);
  if (!state) {
    throw new Error(`${part} must be used inside <AiTerminal>`);
  }
  return state;
}

interface AiTerminalProps extends AiChainOfThoughtProps {
  /**
   * Plain text output. ANSI escape codes are not interpreted (the kit has no
   * ANSI renderer); strip them on the server.
   */
  output: string;
  /** The command is running: the line spins and the output grows. */
  isStreaming?: boolean;
  /** Keep the newest output in view while streaming (default true). */
  autoScroll?: boolean;
  /** Shows the clear button of `AiTerminalClearButton` when set. */
  onClear?: () => void;
}

/**
 * A shell command the agent runs: a line with the command that opens into
 * its output. Uncontrolled, it opens by itself once the first output arrives
 * while running; after the user toggles it, it stays as they left it.
 */
function AiTerminal({
  output,
  isStreaming = false,
  autoScroll = true,
  onClear,
  open,
  defaultOpen,
  onOpenChange,
  className,
  ...props
}: AiTerminalProps) {
  const [chosen, setChosen] = React.useState<boolean | undefined>(defaultOpen);
  const state = React.useMemo<TerminalState>(
    () => ({ output, isStreaming, autoScroll, onClear }),
    [output, isStreaming, autoScroll, onClear],
  );

  return (
    <TerminalContext value={state}>
      <AiChainOfThought
        data-slot="ai-terminal"
        open={open ?? chosen ?? (isStreaming && output.length > 0)}
        onOpenChange={(next, details) => {
          setChosen(next);
          onOpenChange?.(next, details);
        }}
        className={className}
        {...props}
      />
    </TerminalContext>
  );
}

/** The row: the disclosure line plus actions next to it (never inside it). */
function AiTerminalHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-terminal-header"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  );
}

/**
 * The command line, worded by the caller: "Running pnpm build", "Ran pnpm
 * build", "pnpm lint exited with code 1" (pass `status="error"`).
 */
function AiTerminalTitle({
  icon = ComputerTerminal01Icon,
  status,
  className,
  ...props
}: AiChainOfThoughtHeaderProps) {
  const { isStreaming } = useTerminal("AiTerminalTitle");
  return (
    <AiChainOfThoughtHeader
      data-slot="ai-terminal-title"
      icon={icon}
      status={status ?? (isStreaming ? "running" : undefined)}
      className={cn("min-w-0 flex-1", className)}
      {...props}
    />
  );
}

function AiTerminalActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-terminal-actions"
      className={cn("flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  );
}

interface AiTerminalClearButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "children" | "onClick"> {
  /** Accessible name, e.g. "Clear output". */
  label: string;
}

/** Rendered only when the terminal has `onClear`. */
function AiTerminalClearButton({
  label,
  ...props
}: AiTerminalClearButtonProps) {
  const { onClear, output } = useTerminal("AiTerminalClearButton");
  if (!onClear) {
    return null;
  }
  return (
    <Button
      data-slot="ai-terminal-clear-button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      disabled={output.length === 0}
      onClick={onClear}
      {...props}
    >
      <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
    </Button>
  );
}

interface AiTerminalContentProps
  extends Omit<
    React.ComponentProps<typeof AiChainOfThoughtContent>,
    "children"
  > {
  /** Accessible name of the copy button; hidden without it. */
  copyLabel?: string;
  copiedLabel?: string;
}

/**
 * The output in a code block (wrapped, left-to-right, at most 16rem high).
 * It is a `log` region marked busy while the command runs, so a screen
 * reader reads the new output once instead of every chunk.
 */
function AiTerminalContent({
  copyLabel,
  copiedLabel,
  ...props
}: AiTerminalContentProps) {
  const { output, isStreaming, autoScroll } = useTerminal("AiTerminalContent");
  const scroller = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (autoScroll && isStreaming && element && output) {
      element.scrollTop = element.scrollHeight;
    }
  }, [autoScroll, isStreaming, output]);

  return (
    <AiChainOfThoughtContent data-slot="ai-terminal-content" {...props}>
      <div role="log" aria-busy={isStreaming}>
        <CodeBlock
          ref={scroller}
          code={output}
          language="shellscript"
          disableHighlight
          defaultWrap
          copyLabel={output ? copyLabel : undefined}
          copiedLabel={copiedLabel}
          className="max-h-64 overflow-auto text-xs"
        />
      </div>
    </AiChainOfThoughtContent>
  );
}

export {
  AiTerminal,
  AiTerminalActions,
  AiTerminalClearButton,
  type AiTerminalClearButtonProps,
  AiTerminalContent,
  type AiTerminalContentProps,
  AiTerminalHeader,
  type AiTerminalProps,
  AiTerminalTitle,
};

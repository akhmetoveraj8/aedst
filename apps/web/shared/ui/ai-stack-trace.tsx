"use client";

import {
  CommandLineIcon,
  FileCodeIcon,
  Layers01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import type * as React from "react";

import {
  AiChainOfThought,
  AiChainOfThoughtContent,
  AiChainOfThoughtHeader,
  type AiChainOfThoughtHeaderProps,
  type AiChainOfThoughtProps,
} from "@/shared/ui/ai-chain-of-thought";
import { CodeBlock } from "@/shared/ui/code-block";

interface AiStackFrame {
  /** The frame as printed, trimmed. */
  raw: string;
  functionName?: string;
  file?: string;
  line?: number;
  column?: number;
  /** A dependency or runtime frame (node_modules, node:, internal). */
  internal: boolean;
}

interface AiParsedStack {
  /** The first line: "TypeError: Cannot read ...". */
  error: string;
  frames: AiStackFrame[];
}

// V8 "at fn (file:1:2)" / "at file:1:2" and Firefox/Safari "fn@file:1:2".
const V8_FRAME = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const GECKO_FRAME = /^(.*?)@(.+?):(\d+):(\d+)$/;

function parseFrame(raw: string): AiStackFrame {
  const match = V8_FRAME.exec(raw) ?? GECKO_FRAME.exec(raw);
  const file = match?.[2];
  const location = file ?? raw;
  const frame: AiStackFrame = {
    raw,
    internal:
      location.includes("node_modules") ||
      location.startsWith("node:") ||
      location.startsWith("internal/"),
  };
  if (match) {
    if (match[1]) {
      frame.functionName = match[1];
    }
    if (file) {
      frame.file = file;
    }
    frame.line = Number(match[3]);
    frame.column = Number(match[4]);
  }
  return frame;
}

/** Splits `error.stack` into the error line and parsed frames. */
function parseStackTrace(stack: string): AiParsedStack {
  const [error = "", ...rest] = stack
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return { error, frames: rest.map(parseFrame) };
}

/** A failed tool call: a line with the error that opens into the frames. */
function AiStackTrace({ defaultOpen = true, ...props }: AiChainOfThoughtProps) {
  return (
    <AiChainOfThought
      data-slot="ai-stack-trace"
      defaultOpen={defaultOpen}
      {...props}
    />
  );
}

/** The error as the title ("Failed: TypeError ..."); always the error status. */
function AiStackTraceHeader({
  icon = CommandLineIcon,
  ...props
}: Omit<AiChainOfThoughtHeaderProps, "status">) {
  return (
    <AiChainOfThoughtHeader
      data-slot="ai-stack-trace-header"
      icon={icon}
      status="error"
      {...props}
    />
  );
}

function AiStackTraceContent(
  props: React.ComponentProps<typeof AiChainOfThoughtContent>,
) {
  return (
    <AiChainOfThoughtContent data-slot="ai-stack-trace-content" {...props} />
  );
}

/** The full error line: the header truncates, this does not. */
function AiStackTraceError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="ai-stack-trace-error"
      dir="ltr"
      className={cn(
        "font-mono text-xs break-words text-destructive",
        className,
      )}
      {...props}
    />
  );
}

interface AiStackTraceFramesProps
  extends Omit<React.ComponentProps<"div">, "children"> {
  frames: readonly AiStackFrame[];
  /** Turns an app frame into a link (open the file at the line). */
  getFrameHref?: (frame: AiStackFrame) => string | undefined;
  /** Title of the folded dependency frames, e.g. "4 framework frames". */
  internalFramesLabel: string;
  /** Accessible name of the copy button of the dependency frames. */
  copyLabel?: string;
  copiedLabel?: string;
}

function FrameText({ frame }: { frame: AiStackFrame }) {
  if (!frame.file) {
    return <span className="truncate">{frame.raw}</span>;
  }
  return (
    <>
      {frame.functionName ? (
        <span className="shrink-0 text-foreground">{frame.functionName}</span>
      ) : null}
      <span className="min-w-0 truncate">
        {frame.file}:{frame.line}
      </span>
    </>
  );
}

/**
 * App frames first, each a link when `getFrameHref` returns one; dependency
 * frames folded into one collapsible line of their own.
 */
function AiStackTraceFrames({
  frames,
  getFrameHref,
  internalFramesLabel,
  copyLabel,
  copiedLabel,
  className,
  ...props
}: AiStackTraceFramesProps) {
  const appFrames = frames.filter((frame) => !frame.internal);
  const internalFrames = frames.filter((frame) => frame.internal);
  const row =
    "flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 font-mono text-xs text-muted-foreground";

  return (
    <div
      data-slot="ai-stack-trace-frames"
      className={cn("flex flex-col", className)}
      {...props}
    >
      <ol dir="ltr" className="flex flex-col">
        {appFrames.map((frame, index) => {
          const href = getFrameHref?.(frame);
          const icon = (
            <HugeiconsIcon
              icon={FileCodeIcon}
              strokeWidth={2}
              aria-hidden="true"
              className="size-4 shrink-0"
            />
          );
          return (
            // Frames can repeat (recursion), so the index is part of the key.
            <li key={`${index}:${frame.raw}`}>
              {href ? (
                <a
                  href={href}
                  className={cn(
                    row,
                    "outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring",
                  )}
                >
                  {icon}
                  <FrameText frame={frame} />
                </a>
              ) : (
                <span className={row}>
                  {icon}
                  <FrameText frame={frame} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {internalFrames.length > 0 ? (
        <AiChainOfThought>
          <AiChainOfThoughtHeader icon={Layers01Icon}>
            {internalFramesLabel}
          </AiChainOfThoughtHeader>
          <AiChainOfThoughtContent>
            <CodeBlock
              code={internalFrames.map((frame) => frame.raw).join("\n")}
              copyLabel={copyLabel}
              copiedLabel={copiedLabel}
              disableHighlight
              className="max-h-64 overflow-auto text-xs"
            />
          </AiChainOfThoughtContent>
        </AiChainOfThought>
      ) : null}
    </div>
  );
}

export {
  type AiParsedStack,
  type AiStackFrame,
  AiStackTrace,
  AiStackTraceContent,
  AiStackTraceError,
  AiStackTraceFrames,
  type AiStackTraceFramesProps,
  AiStackTraceHeader,
  parseStackTrace,
};

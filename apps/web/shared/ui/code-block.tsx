"use client";

import {
  Copy01Icon,
  TextWrapIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import * as React from "react";

import { Button } from "@/shared/ui/button";
import { Toggle } from "@/shared/ui/toggle";

const COPIED_RESET_MS = 2000;

interface CodeBlockProps extends Omit<React.ComponentProps<"div">, "children"> {
  code: string;
  /** Shown in the header, always left-to-right. */
  filename?: string;
  /** Language label for the header (also passed as `data-language`). */
  language?: string;
  showLineNumbers?: boolean;
  /** 1-based line numbers to emphasize. */
  highlightLines?: readonly number[];
  defaultWrap?: boolean;
  /** Accessible name of the wrap toggle; the toggle is hidden without it. */
  wrapLabel?: string;
  /** Accessible name of the copy button; the button is hidden without it. */
  copyLabel?: string;
  /** Announced once the code is on the clipboard. */
  copiedLabel?: string;
  /** The clipboard write was refused (permissions, insecure context). */
  onCopyError?: (error: unknown) => void;
  /**
   * Syntax highlighting seam: returns the content of one line (1-based).
   * The kit ships no highlighter; a caller plugs one in lazily.
   */
  highlight?: (line: string, lineNumber: number) => React.ReactNode;
}

/**
 * Code display: optional header (file name, language, wrap toggle, copy
 * button), line numbers and line emphasis. The code itself is always
 * `dir="ltr"` and scrolls horizontally unless wrapped.
 */
function CodeBlock({
  code,
  filename,
  language,
  showLineNumbers = false,
  highlightLines,
  defaultWrap = false,
  wrapLabel,
  copyLabel,
  copiedLabel,
  onCopyError,
  highlight,
  className,
  ...props
}: CodeBlockProps) {
  const [wrap, setWrap] = React.useState(defaultWrap);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch (error) {
      onCopyError?.(error);
    }
  }

  const lines = code
    .replace(/\n$/, "")
    .split("\n")
    .map((text, index) => ({ text, number: index + 1 }));
  const emphasized = new Set(highlightLines);
  const hasHeader = Boolean(filename || language || wrapLabel || copyLabel);

  return (
    <div
      data-slot="code-block"
      data-language={language}
      className={cn(
        "overflow-hidden rounded-lg border bg-card text-card-foreground",
        className,
      )}
      {...props}
    >
      {hasHeader ? (
        <div
          data-slot="code-block-header"
          className="flex min-h-10 items-center gap-2 border-b bg-muted/50 px-3 py-1"
        >
          {filename ? (
            <span dir="ltr" className="truncate font-mono text-xs font-medium">
              {filename}
            </span>
          ) : null}
          {language ? (
            <span className="text-xs text-muted-foreground">{language}</span>
          ) : null}
          <div className="ms-auto flex items-center gap-1">
            {wrapLabel ? (
              <Toggle
                size="sm"
                aria-label={wrapLabel}
                pressed={wrap}
                onPressedChange={setWrap}
              >
                <HugeiconsIcon icon={TextWrapIcon} strokeWidth={2} />
              </Toggle>
            ) : null}
            {copyLabel ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={copyLabel}
                onClick={handleCopy}
              >
                <HugeiconsIcon
                  icon={copied ? Tick02Icon : Copy01Icon}
                  strokeWidth={2}
                />
              </Button>
            ) : null}
            <span role="status" aria-live="polite" className="sr-only">
              {copied ? copiedLabel : null}
            </span>
          </div>
        </div>
      ) : null}
      <pre
        dir="ltr"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard reachable
        tabIndex={0}
        data-wrap={wrap}
        className="overflow-x-auto py-3 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset data-[wrap=true]:wrap-anywhere data-[wrap=true]:whitespace-pre-wrap"
      >
        <code className={cn("grid min-w-full", wrap ? "w-full" : "w-max")}>
          {lines.map((line) => (
            <span
              key={line.number}
              data-slot="code-block-line"
              data-highlighted={emphasized.has(line.number) || undefined}
              className="flex border-s-2 border-transparent px-3 data-highlighted:border-primary data-highlighted:bg-muted"
            >
              {showLineNumbers ? (
                <span
                  aria-hidden="true"
                  className="w-8 shrink-0 pe-3 text-end text-muted-foreground tabular-nums select-none"
                >
                  {line.number}
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                {highlight ? highlight(line.text, line.number) : line.text}
                {"\n"}
              </span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export { CodeBlock, type CodeBlockProps };

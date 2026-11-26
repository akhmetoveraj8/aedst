"use client";

import {
  Copy01Icon,
  TextWrapIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import * as React from "react";
import type { ThemedToken } from "shiki/core";

import {
  tokensForLine,
  useHighlightedCode,
} from "@/shared/lib/hooks/use-highlighted-code";
import { Button } from "@/shared/ui/button";
import { Toggle } from "@/shared/ui/toggle";

const COPIED_RESET_MS = 2000;

/** One line: coloured Shiki tokens when available, plain text otherwise. */
function LineTokens({
  text,
  tokens,
}: {
  text: string;
  tokens: readonly ThemedToken[] | undefined;
}) {
  if (!tokens) {
    return text;
  }
  return tokens.map((token) => (
    <span
      key={token.offset}
      data-slot="code-block-token"
      // Only `var(--syntax-*)` values (shared/lib/code-highlight/syntax-theme.ts).
      style={{ color: token.color }}
    >
      {token.content}
    </span>
  ));
}

interface CodeBlockProps extends Omit<React.ComponentProps<"div">, "children"> {
  code: string;
  /** Shown in the header, always left-to-right. */
  filename?: string;
  /**
   * Language label for the header (also passed as `data-language`). A known
   * name or alias ("TypeScript", "ts", "bash") also selects the grammar.
   */
  language?: string;
  /** Turns the built-in highlighting off (the code stays plain text). */
  disableHighlight?: boolean;
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
   * Overrides the built-in highlighter: returns the content of one line
   * (1-based). When set, Shiki is not loaded.
   */
  highlight?: (line: string, lineNumber: number) => React.ReactNode;
}

/**
 * Code display: optional header (file name, language, wrap toggle, copy
 * button), line numbers, line emphasis and syntax highlighting. Highlighting
 * is Shiki, loaded lazily on first mount for a known `language` and coloured
 * with the `--syntax-*` tokens (light and dark); until it arrives, and for
 * unknown languages, the code is plain text. While code streams in, lines
 * already highlighted keep their colours. The code itself is always
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
  disableHighlight = false,
  className,
  ...props
}: CodeBlockProps) {
  const [wrap, setWrap] = React.useState(defaultWrap);
  const [copied, setCopied] = React.useState(false);
  const highlighted = useHighlightedCode(
    code,
    language,
    !(disableHighlight || highlight),
  );

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
    .map((text, index) => ({
      text,
      number: index + 1,
      tokens: tokensForLine(highlighted, index, text),
    }));
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
        className="overflow-x-auto py-3 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset data-[wrap=true]:wrap-anywhere data-[wrap=true]:whitespace-pre-wrap"
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
                {highlight ? (
                  highlight(line.text, line.number)
                ) : (
                  <LineTokens text={line.text} tokens={line.tokens} />
                )}
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

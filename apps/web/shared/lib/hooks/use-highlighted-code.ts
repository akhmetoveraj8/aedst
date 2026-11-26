"use client";

import * as React from "react";
import type { ThemedToken } from "shiki/core";

import { resolveHighlightLanguage } from "@/shared/lib/code-highlight/languages";

/** Larger inputs stay plain: tokenizing runs on the main thread. */
const MAX_HIGHLIGHT_CHARS = 100_000;

interface HighlightedCode {
  /** The grammar the tokens were computed with. */
  grammar: string;
  /** The source lines the tokens were computed for. */
  lines: readonly string[];
  /** Tokens per line; `tokens[i]` belongs to `lines[i]`. */
  tokens: readonly (readonly ThemedToken[])[];
}

/**
 * Syntax tokens for `code`, computed lazily with Shiki (dynamic import: no
 * cost until a highlightable block mounts). Returns `null` until the first
 * result, when disabled, for an unknown language or oversized input; the
 * caller renders plain text meanwhile.
 *
 * Streaming: while new code highlights, the previous result is kept, so a
 * caller can reuse the tokens of every line whose text did not change (see
 * `tokensForLine`) and only the growing tail renders plain for a moment.
 * Results apply in request order; a late, older result never replaces a newer.
 */
function useHighlightedCode(
  code: string,
  language: string | undefined,
  enabled = true,
): HighlightedCode | null {
  const grammar = resolveHighlightLanguage(language);
  const active =
    enabled && grammar !== undefined && code.length <= MAX_HIGHLIGHT_CHARS;
  const [result, setResult] = React.useState<HighlightedCode | null>(null);
  // Request order: a late, older result never replaces a newer one, and an
  // older result still applies while a newer one is pending (streaming).
  const requested = React.useRef(0);
  const applied = React.useRef(0);

  React.useEffect(() => {
    if (!active || grammar === undefined) {
      return;
    }
    requested.current += 1;
    const request = requested.current;
    const source = code.replace(/\n$/, "");

    import("@/shared/lib/code-highlight/highlighter")
      .then(({ highlightToTokens }) => highlightToTokens(source, grammar))
      .then((tokens) => {
        if (request > applied.current) {
          applied.current = request;
          setResult({ grammar, lines: source.split("\n"), tokens });
        }
      })
      .catch(() => {
        // Highlighting is progressive enhancement: plain text stays.
      });
  }, [active, code, grammar]);

  return active && result?.grammar === grammar ? result : null;
}

/** Tokens for one line when the highlighted result still matches its text. */
function tokensForLine(
  highlighted: HighlightedCode | null,
  index: number,
  text: string,
): readonly ThemedToken[] | undefined {
  if (!highlighted || highlighted.lines[index] !== text) {
    return undefined;
  }
  return highlighted.tokens[index];
}

export { type HighlightedCode, tokensForLine, useHighlightedCode };

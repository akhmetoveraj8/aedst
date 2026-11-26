import {
  createHighlighterCore,
  type HighlighterCore,
  type ThemedToken,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import {
  type HighlightLanguage,
  LANGUAGE_LOADERS,
} from "@/shared/lib/code-highlight/languages";
import { SYNTAX_THEME } from "@/shared/lib/code-highlight/syntax-theme";

/**
 * Loaded only through a dynamic import (use-highlighted-code.ts), so pages
 * without a code block never download Shiki. One highlighter per page: the
 * JavaScript regex engine (no WebAssembly download, no `wasm-unsafe-eval` in
 * the CSP) and the token theme; grammars are added on first use.
 */
let highlighter: Promise<HighlighterCore> | undefined;
const loading = new Map<HighlightLanguage, Promise<void>>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [SYNTAX_THEME],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

async function ensureLanguage(
  core: HighlighterCore,
  language: HighlightLanguage,
): Promise<void> {
  let pending = loading.get(language);
  if (!pending) {
    pending = LANGUAGE_LOADERS[language]()
      .then((module) => core.loadLanguage(...module.default))
      .catch((error: unknown) => {
        // Let a later call retry (a chunk can fail on a flaky network).
        loading.delete(language);
        throw error;
      });
    loading.set(language, pending);
  }
  await pending;
}

/** Tokens per line (no trailing empty line), coloured with `var(--syntax-*)`. */
async function highlightToTokens(
  code: string,
  language: HighlightLanguage,
): Promise<ThemedToken[][]> {
  const core = await getHighlighter();
  await ensureLanguage(core, language);
  return core.codeToTokensBase(code, {
    lang: language,
    theme: SYNTAX_THEME.name ?? "aedst-tokens",
  });
}

export { highlightToTokens };

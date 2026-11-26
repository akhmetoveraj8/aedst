import type { LanguageRegistration } from "shiki/core";

type LanguageLoader = () => Promise<{ default: LanguageRegistration[] }>;

/**
 * Grammars the kit can highlight, each a separate lazy chunk loaded on first
 * use. A curated list instead of Shiki's full bundle: every listed grammar is
 * an emitted chunk counted by the bundle budget (`totalJsGzipKB`), and the
 * full bundle emits a few hundred. Add a grammar here when a screen needs it.
 */
const LANGUAGE_LOADERS = {
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  proto: () => import("shiki/langs/proto.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
} satisfies Record<string, LanguageLoader>;

type HighlightLanguage = keyof typeof LANGUAGE_LOADERS;

const ALIASES: Readonly<Record<string, HighlightLanguage>> = {
  bash: "shellscript",
  js: "javascript",
  kt: "kotlin",
  md: "markdown",
  protobuf: "proto",
  py: "python",
  rs: "rust",
  sh: "shellscript",
  shell: "shellscript",
  ts: "typescript",
  yml: "yaml",
  zsh: "shellscript",
};

function isHighlightLanguage(name: string): name is HighlightLanguage {
  return Object.hasOwn(LANGUAGE_LOADERS, name);
}

/**
 * Maps a language name or label ("TypeScript", "ts", "Bash") to a grammar id,
 * or `undefined` when the kit has no grammar for it (the code stays plain).
 */
function resolveHighlightLanguage(
  language: string | undefined,
): HighlightLanguage | undefined {
  const name = language?.trim().toLowerCase();
  if (!name) {
    return undefined;
  }
  if (isHighlightLanguage(name)) {
    return name;
  }
  return Object.hasOwn(ALIASES, name) ? ALIASES[name] : undefined;
}

export { type HighlightLanguage, LANGUAGE_LOADERS, resolveHighlightLanguage };

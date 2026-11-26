import type { ThemeRegistration } from "shiki/core";

/**
 * Shiki theme whose colours are the design-token CSS variables
 * (`--syntax-*`, generated into shared/ui/tokens.css for light and dark), so
 * the highlighted code follows the active theme and the token contrast
 * guarantees (WCAG AA on card and muted) without a second theme or a
 * re-highlight when the theme changes. TextMate scopes are matched by prefix,
 * the most specific selector wins (`keyword.operator` beats `keyword`).
 */
const SYNTAX_THEME: ThemeRegistration = {
  name: "aedst-tokens",
  type: "light",
  colors: {
    "editor.foreground": "var(--card-foreground)",
    "editor.background": "var(--card)",
  },
  tokenColors: [
    {
      scope: [
        "comment",
        "punctuation.definition.comment",
        "string.quoted.docstring",
      ],
      settings: { foreground: "var(--syntax-comment)" },
    },
    {
      scope: [
        "keyword",
        "storage",
        "variable.language",
        "markup.heading",
        "entity.name.tag.yaml",
      ],
      settings: { foreground: "var(--syntax-keyword)" },
    },
    {
      scope: [
        "string",
        "markup.inline.raw",
        "markup.fenced_code",
        "markup.inserted",
      ],
      settings: { foreground: "var(--syntax-string)" },
    },
    {
      scope: [
        "constant.numeric",
        "constant.language",
        "constant.character",
        "constant.other",
        "markup.deleted",
      ],
      settings: { foreground: "var(--syntax-number)" },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call entity.name.function",
        "markup.underline.link",
      ],
      settings: { foreground: "var(--syntax-function)" },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.name.tag",
        "entity.other.inherited-class",
        "entity.other.attribute-name",
        "support.type",
        "support.class",
        "storage.type.primitive",
      ],
      settings: { foreground: "var(--syntax-type)" },
    },
    {
      scope: [
        "punctuation",
        "meta.brace",
        "keyword.operator",
        "punctuation.definition.string",
      ],
      settings: { foreground: "var(--syntax-punctuation)" },
    },
  ],
};

export { SYNTAX_THEME };

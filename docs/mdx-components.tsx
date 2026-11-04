import { useMDXComponents as getThemeComponents } from "nextra-theme-docs";

// Nextra reads its default MDX component set (headings, callouts, tables,
// code blocks, ...) from the theme; merge in project-specific overrides here
// if/when they're needed.
const themeComponents = getThemeComponents();

export function useMDXComponents(components: Record<string, unknown> = {}) {
  return {
    ...themeComponents,
    ...components,
  };
}

import { afterEach, expect } from "vitest";
import { page } from "vitest/browser";

// Visual regression (opt-in: `pnpm test:visual`, `pnpm test:visual:update`).
// Storybook's vitest addon applies .storybook/preview.tsx by itself; this file
// only adds a screenshot comparison of each rendered story in both themes.
if (import.meta.env.STORYBOOK_VISUAL) {
  afterEach(async (context) => {
    const root = document.documentElement;
    const target = page.elementLocator(
      document.querySelector("#storybook-root") ?? document.body,
    );
    const name = context.task.name;
    for (const theme of ["light", "dark"] as const) {
      root.classList.toggle("dark", theme === "dark");
      await expect.element(target).toMatchScreenshot(`${name}-${theme}`);
    }
    root.classList.remove("dark");
  });
}

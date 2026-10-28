import path from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Story tests: every story of `../shared/ui` is rendered in real Chromium
 * (smoke test + the a11y addon's axe run, `a11y.test: "error"` in
 * `.storybook/preview.tsx`). With STORYBOOK_VISUAL=1 each story is also
 * screenshot-compared against committed baselines (see
 * `.storybook/vitest.setup.ts`). Kept out of the default `vitest run`
 * so the coverage ratchet and the app test run are unaffected.
 */
export default defineConfig({
  plugins: [
    storybookTest({ configDir: path.join(root, ".storybook"), tags: {} }),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@/shared": path.resolve(root, "../shared"),
      "@": path.resolve(root, "src"),
    },
  },
  test: {
    name: "stories",
    testTimeout: 30_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        contextOptions: { locale: "en-US", timezoneId: "UTC" },
      }),
      // Baselines are committed (the default __screenshots__ dir is gitignored)
      // and are per browser+platform: generate them on the CI runner.
      expect: {
        toMatchScreenshot: { screenshotDirectory: "visual-baselines" },
      },
      instances: [
        { browser: "chromium", viewport: { width: 800, height: 600 } },
      ],
    },
    env: { STORYBOOK_VISUAL: process.env.STORYBOOK_VISUAL ?? "" },
    setupFiles: ["./.storybook/vitest.setup.ts"],
  },
});

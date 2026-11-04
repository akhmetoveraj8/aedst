import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/nextjs-vite";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Component workshop for the shared design system (`apps/web/shared/ui`) and a few
 * composite module screens (`src/modules/<m>/ui/*.stories.tsx`, backed by the
 * typed in-memory Connect transport, see `with-app-providers.tsx`). Dev-only:
 * nothing here is imported by the app, so the client bundle budget is
 * unaffected. Stories live next to their component (`button.stories.tsx`).
 */
const config: StorybookConfig = {
  framework: "@storybook/nextjs-vite",
  stories: [
    "../../shared/ui/**/*.stories.@(ts|tsx)",
    "../src/modules/*/ui/*.stories.@(ts|tsx)",
  ],
  addons: ["@storybook/addon-a11y", "@storybook/addon-vitest"],
  // No usage telemetry from a repo-wide dev tool.
  core: { disableTelemetry: true },
  staticDirs: ["../public"],
  // next-intl's navigation needs a mounted App Router, which a story does not
  // have: module screens get a navigation stub instead.
  viteFinal: (viteConfig) => {
    const existing = viteConfig.resolve?.alias;
    const aliases = Array.isArray(existing)
      ? existing
      : Object.entries(existing ?? {}).map(([find, replacement]) => ({
          find,
          replacement,
        }));
    return {
      ...viteConfig,
      resolve: {
        ...viteConfig.resolve,
        alias: [
          {
            find: /^@\/shared\/i18n\/navigation$/,
            replacement: path.join(here, "navigation-stub.tsx"),
          },
          ...aliases,
        ],
      },
    };
  },
};

export default config;

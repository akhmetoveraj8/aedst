import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { adminAliases } from "./vite.aliases.ts";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],

  resolve: {
    // Same aliases as vite.config.ts; component tests then replace the
    // aliased navigation seam with a spy-able stub (vitest.setup.ts).
    alias: [
      ...adminAliases(root),
      {
        find: "server-only",
        replacement: path.resolve(root, "src/test/mocks/empty-module.ts"),
      },
    ],
  },

  // Browser-mode dev server serves only files under its root unless told
  // otherwise: shared/ is a sibling directory.
  server: { fs: { allow: [path.resolve(root, "..")] } },

  test: {
    globals: false,
    testTimeout: 15_000,
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,

    // Same two projects as apps/web/app (the BFF under server/ has its own tests):
    //  - unit: pure logic in Node.
    //  - browser: component/hook tests (*.test.tsx, *.browser.test.ts) in real
    //    Chromium with the in-memory Connect router transport.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["node_modules", "dist", "src/**/*.browser.test.ts"],
        },
      },
      {
        extends: true,
        optimizeDeps: {
          include: [
            "@tanstack/react-virtual",
            "@base-ui/react/direction-provider",
            "@base-ui/react/menu",
            "@base-ui/react/select",
            "next-themes",
            "nuqs/adapters/tanstack-router",
            "zod",
          ],
        },
        test: {
          name: "browser",
          include: ["src/**/*.test.tsx", "src/**/*.browser.test.ts"],
          exclude: ["node_modules", "dist"],
          setupFiles: ["./vitest.setup.browser-env.ts", "./vitest.setup.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              contextOptions: { locale: "en-US", timezoneId: "UTC" },
            }),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],

    env: {
      NEXT_PUBLIC_SITE_URL: "http://localhost:3001",
    },
  },
});

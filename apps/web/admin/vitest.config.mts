import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],

  resolve: {
    // Order matters: `@/shared/*` lives in ../shared (next to the project, not
    // under src/) and must win over the generic `@/*` -> src/* alias.
    alias: [
      {
        find: /^@\/shared\//,
        replacement: `${path.resolve(root, "../shared")}/`,
      },
      { find: /^@app\//, replacement: `${path.resolve(root, "src/app")}/` },
      { find: /^@\//, replacement: `${path.resolve(root, "src")}/` },
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

    // Same two projects as apps/web/app:
    //  - unit: pure logic and server-side code (proxy, route handlers) in Node;
    //    the global fetch only answers declared apps/server routes.
    //  - browser: component/hook tests (*.test.tsx, *.browser.test.ts) in real
    //    Chromium with the in-memory Connect router transport.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["node_modules", ".next", "src/**/*.browser.test.ts"],
          setupFiles: ["./vitest.setup.node.ts"],
          // next-intl imports `next/server` without a file extension.
          server: { deps: { inline: [/next-intl/] } },
        },
      },
      {
        extends: true,
        optimizeDeps: {
          include: ["next-intl/server", "@tanstack/react-virtual"],
        },
        test: {
          name: "browser",
          include: ["src/**/*.test.tsx", "src/**/*.browser.test.ts"],
          exclude: ["node_modules", ".next"],
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
      API_BASE_URL: "http://localhost:8080",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3001",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      AUTH_COOKIE_NAME: "aedst_admin_session",
      OIDC_ISSUER: "http://localhost:8085",
      OIDC_CLIENT_ID: "aedst-admin-test",
    },
  },
});

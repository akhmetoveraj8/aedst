import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],

  resolve: {
    // Vite-native tsconfig `paths` (replaces the vite-tsconfig-paths plugin).
    tsconfigPaths: true,
    alias: {
      // shared/ is a sibling directory (source-only kit); it must win over "@".
      "@/shared": path.resolve(root, "../shared"),
      "@": path.resolve(root, "src"),
      "@app": path.resolve(root, "src/app"),
      "server-only": path.resolve(root, "src/test/mocks/empty-module.ts"),
    },
  },

  // The contract replay tests read docs/contract/behavior/*.json from the
  // repo root (the single source for all platforms); the browser-mode dev
  // server only serves files under its root unless told otherwise.
  server: { fs: { allow: [path.resolve(root, "../..")] } },

  test: {
    globals: false,

    // Component tests do real Connect round trips (through the in-memory
    // router transport) and real user-event typing; 5 s is too tight on a
    // loaded runner with coverage.
    testTimeout: 15_000,

    restoreMocks: true,
    clearMocks: true,
    mockReset: true,

    // include/exclude are per project (vite merges arrays by concatenation, so
    // a root-level include would leak into every project).
    // Two projects, split by what a test needs from its environment:
    //  - unit: pure logic and server-side code (route handlers, proxy, Server
    //    Actions, the OIDC flow, server transport) in plain Node. No DOM. The
    //    global fetch is a stub that only answers declared apps/server routes
    //    (vitest.setup.node.ts); IdP calls take an injected fetch.
    //  - browser: every component/hook/store test (*.test.tsx and
    //    *.browser.test.ts) in real Chromium via Vitest Browser Mode, with the
    //    in-memory Connect router transport (src/test/mocks/transport.ts).
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "../shared/**/*.test.ts"],
          exclude: [
            "**/node_modules/**",
            "../shared/node_modules/**",
            ".next",
            "e2e",
            "playwright",
            "src/**/*.browser.test.ts",
            "../shared/**/*.browser.test.ts",
          ],
          setupFiles: ["./vitest.setup.node.ts"],
          // next-intl imports `next/server` without a file extension, which
          // Node's ESM loader rejects; inlining lets Vite resolve it (needed
          // by proxy.test.ts).
          server: { deps: { inline: [/next-intl/] } },
        },
      },
      {
        extends: true,
        // Found late by Vite on a cold cache ("optimized dependencies changed.
        // reloading"), which reloads the page mid-run and fails random files.
        optimizeDeps: {
          include: ["next-intl/server", "@tanstack/react-virtual"],
        },
        test: {
          name: "browser",
          include: [
            "src/**/*.test.tsx",
            "src/**/*.browser.test.ts",
            "../shared/**/*.test.tsx",
            "../shared/**/*.browser.test.ts",
          ],
          exclude: [
            "**/node_modules/**",
            "../shared/node_modules/**",
            ".next",
            "e2e",
            "playwright",
          ],
          setupFiles: ["./vitest.setup.browser-env.ts", "./vitest.setup.ts"],
          browser: {
            enabled: true,
            headless: true,
            // Deterministic locale/time zone: components format dates and pick the
            // default language from the browser, and the CI runner differs from
            // a developer machine.
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
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      AUTH_COOKIE_NAME: "aedst_session",
      // Read by getOidcConfig(); the same values as src/test/mocks/oidc.ts.
      OIDC_ISSUER: "http://localhost:8085",
      OIDC_CLIENT_ID: "aedst-web-test",
      OIDC_STATE_SECRET: "test-state-secret-test-state-secret-0123",
    },

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      // Measured over hand-written code only: vendored shadcn primitives,
      // generated protobuf stubs, test helpers and framework glue that only a
      // running Next server can exercise (covered by Playwright instead).
      include: ["src/**/*.{ts,tsx}", "../shared/**/*.{ts,tsx}"],
      exclude: [
        "**/*.d.ts",
        "**/*.config.*",
        "**/generated/**",
        "**/index.ts",
        "**/*.test.{ts,tsx}",
        "../shared/ui/**",
        "src/test/**",
        "src/instrumentation*.ts",
        "src/app/config/sentry/**",
        "src/app/config/monitoring/**",
        "src/app/**/opengraph-image.tsx",
        "src/app/manifest.ts",
        "src/app/sitemap.ts",
        // Framework glue that only a running Next server can execute — layouts,
        // loading states, async route pages (their sections are unit-tested),
        // font loaders and next-intl wiring. Covered end to end by Playwright.
        "**/layout.tsx",
        "**/loading.tsx",
        // Wildcards, not literal "(pages)/[locale]/(app)": parentheses and
        // brackets are glob syntax.
        "src/app/*pages*/*locale*/*app*/**/page.tsx",
        "src/app/*pages*/*locale*/forbidden/page.tsx",
        // Runs inside the service worker / needs a registered worker, and the
        // build-time asset routes: exercised by Playwright (e2e/pwa.spec.ts).
        "src/app/sw.ts",
        "src/app/serwist/**",
        "src/app/icons/**",
        "src/app/providers/pwa-provider.tsx",
        "src/app/config/fonts.ts",
        "src/app/config/i18n/{messages,modules,navigation,request,routing}.ts",
      ],
      // Ratchet: set just under the measured baseline so coverage can only go
      // up. Raise these as tests are added; never lower them to make CI pass.
      thresholds: {
        lines: 88,
        functions: 83,
        branches: 84,
        statements: 88,
      },
    },
  },
});

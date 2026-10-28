import { defineConfig } from "vitest/config";

// Landing is static and has no client state worth a browser project: every
// test is a pure Node unit test (SEO builders, route tables, i18n parity).
export default defineConfig({
  resolve: {
    // Vite-native tsconfig `paths`: `@/shared/*` -> ../shared/*, `@/*` -> src/*.
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    restoreMocks: true,
    env: {
      NEXT_PUBLIC_SITE_URL: "http://localhost:3002",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    },
  },
});

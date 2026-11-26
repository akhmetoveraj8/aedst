import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// Marketing is static and has no client state worth a browser project: every
// test is a pure Node unit test (SEO builders, route tables, i18n parity).
export default defineConfig({
  resolve: {
    // Vite-native tsconfig `paths`: `@/shared/*` -> ../shared/*, `@/*` -> src/*.
    tsconfigPaths: true,
    // tsconfig paths apply only to files the tsconfig includes, so a kit file
    // in ../shared importing `@/shared/*` needs the alias spelled out.
    alias: {
      "@/shared": path.resolve(root, "../shared"),
      "@i18n": path.resolve(root, "../shared/i18n/catalogs"),
    },
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

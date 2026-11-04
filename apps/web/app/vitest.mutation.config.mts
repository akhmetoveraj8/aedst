import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// Node-only slice of the unit project for Stryker: the logic under
// ../shared/lib/{errors,auth,forms,outbox} that needs no DOM or browser.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": path.resolve(root, "src"),
      "@app": path.resolve(root, "src/app"),
      "server-only": path.resolve(root, "src/test/mocks/empty-module.ts"),
    },
  },
  test: {
    environment: "node",
    include: [
      "../shared/lib/errors/**/*.test.ts",
      "../shared/lib/auth/**/*.test.ts",
      "../shared/lib/forms/**/*.test.ts",
      "../shared/lib/outbox/**/*.test.ts",
      // Replays of docs/contract/behavior/*.json cover the error and session rules.
      "src/test/contract/*.replay.test.ts",
    ],
    exclude: ["**/*.browser.test.ts", "node_modules"],
    setupFiles: ["./vitest.setup.node.ts"],
    server: { deps: { inline: [/next-intl/] } },
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    env: {
      API_BASE_URL: "http://localhost:8080",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      AUTH_COOKIE_NAME: "aedst_session",
      OIDC_ISSUER: "http://localhost:8085",
      OIDC_CLIENT_ID: "aedst-web-test",
      OIDC_STATE_SECRET: "test-state-secret-test-state-secret-0123",
    },
  },
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// Tests of the Hono BFF (server/), Node only. Kept apart from the SPA's
// vitest.config.mts: no React, no browser, and the env below stands in for
// what bootstrap.ts mirrors from the validated server env at runtime.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\/shared\//,
        replacement: `${path.resolve(root, "../shared")}/`,
      },
      {
        find: "server-only",
        replacement: path.resolve(root, "server/stubs/server-only.ts"),
      },
    ],
  },
  test: {
    name: "server",
    environment: "node",
    include: ["server/**/*.test.ts"],
    testTimeout: 15_000,
    restoreMocks: true,
    env: {
      NODE_ENV: "test",
      API_BASE_URL: "http://localhost:8080",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3001",
      AUTH_COOKIE_NAME: "aedst_admin_session",
      OIDC_ISSUER: "http://localhost:8085",
      OIDC_CLIENT_ID: "aedst-admin-test",
    },
  },
});

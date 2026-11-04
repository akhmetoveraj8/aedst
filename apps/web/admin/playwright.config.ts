import { defineConfig, devices } from "@playwright/test";

// 3101, not the dev port 3001: `reuseExistingServer` must never pick up a dev
// server that was started without the mock-API environment below.
const ADMIN_PORT = Number(process.env.E2E_ADMIN_PORT ?? 3101);
const MOCK_API_PORT = 8181;
const baseURL = `http://127.0.0.1:${ADMIN_PORT}`;
const mockApiURL = `http://127.0.0.1:${MOCK_API_PORT}`;

export default defineConfig({
  testDir: "./e2e",

  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // The dev server compiles routes on first hit; more workers just queue on it.
  workers: 2,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  timeout: 60_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    testIdAttribute: "data-testid",
  },

  webServer: [
    {
      // The one mock of apps/server and of the identity provider, shared with
      // the app project (test infrastructure for the server contract, not
      // product code). It serves both OIDC clients: aedst-web-e2e and aedst-admin.
      // The app's config starts the same command; with `reuseExistingServer`
      // a second run attaches to the first.
      command: "node ../app/e2e/mock-api/server.mjs",
      env: { MOCK_API_PORT: String(MOCK_API_PORT) },
      url: `${mockApiURL}/__test/health`,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: process.env.CI
        ? `pnpm start -p ${ADMIN_PORT}`
        : `pnpm dev -p ${ADMIN_PORT}`,
      env: {
        API_BASE_URL: mockApiURL,
        OIDC_ISSUER: `${mockApiURL}/oidc`,
        OIDC_CLIENT_ID: "aedst-admin",
        OIDC_PROJECT_ID: "aedst-api-e2e",
        OIDC_STATE_SECRET: "e2e-only-state-secret-e2e-only-state-secret",
        AUTH_ROLES_CLAIM: "urn:zitadel:iam:org:project:roles",
        AUTH_COOKIE_NAME: "aedst_admin_session",
        NEXT_PUBLIC_SITE_URL: baseURL,
      },
      url: `${baseURL}/api/healthz`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],

  // The admin panel is desktop tooling: one engine is enough.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

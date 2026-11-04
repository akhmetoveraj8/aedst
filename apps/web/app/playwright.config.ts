import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const MOCK_API_PORT = 8181;
const baseURL = `http://127.0.0.1:${WEB_PORT}`;
const mockApiURL = `http://127.0.0.1:${MOCK_API_PORT}`;

export default defineConfig({
  testDir: "./e2e",

  fullyParallel: true,

  forbidOnly: Boolean(process.env.CI),

  retries: process.env.CI ? 2 : 0,

  workers: process.env.CI ? 2 : undefined,

  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  timeout: 30_000,

  expect: {
    timeout: 5_000,
  },

  use: {
    baseURL,

    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",

    actionTimeout: 10_000,
    navigationTimeout: 30_000,

    testIdAttribute: "data-testid",

    // The production build registers a service worker. Pages under test run
    // without it so every spec sees the network directly (and Playwright's
    // WebKit on Windows breaks once a worker claims the page); e2e/pwa.spec.ts
    // opts back in to exercise the worker itself on Chromium.
    serviceWorkers: "block",
  },

  webServer: [
    {
      // In-memory stand-in for apps/server (see e2e/mock-api/server.mjs), so
      // the flows behind authentication run in CI with no Postgres/Go.
      command: "node e2e/mock-api/server.mjs",
      env: { MOCK_API_PORT: String(MOCK_API_PORT) },
      url: `${mockApiURL}/__test/health`,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: process.env.CI
        ? `pnpm start --port ${WEB_PORT}`
        : `pnpm dev --port ${WEB_PORT}`,
      env: {
        API_BASE_URL: mockApiURL,
        // The mock API doubles as the OpenID Connect provider (e2e/mock-api/oidc.mjs).
        OIDC_ISSUER: `${mockApiURL}/oidc`,
        OIDC_CLIENT_ID: "aedst-web-e2e",
        OIDC_PROJECT_ID: "aedst-api-e2e",
        OIDC_STATE_SECRET: "e2e-only-state-secret-e2e-only-state-secret",
        // ZITADEL's roles claim, as the mock IdP issues it.
        AUTH_ROLES_CLAIM: "urn:zitadel:iam:org:project:roles",
        NEXT_PUBLIC_SITE_URL: baseURL,
        // The mock doubles as object storage for presigned uploads.
        MEDIA_ORIGINS: mockApiURL,
      },
      url: baseURL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],

  // Browser matrix: the three engines on desktop, plus a touch phone on each
  // of the two mobile engines. Specs that only make sense at one viewport
  // skip themselves via `test.info().project`.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],
});

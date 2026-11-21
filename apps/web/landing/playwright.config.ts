import { defineConfig, devices } from "@playwright/test";

// 3102, not the dev port 3002: `reuseExistingServer` must never pick up a dev
// server (dev HTML is not the HTML crawlers get).
const LANDING_PORT = Number(process.env.E2E_LANDING_PORT ?? 3102);
const baseURL = `http://127.0.0.1:${LANDING_PORT}`;

export default defineConfig({
  testDir: "./e2e",

  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  webServer: {
    // The production build: the specs assert the HTML a crawler receives. CI
    // builds in an earlier step; locally this builds first.
    command: process.env.CI
      ? `pnpm start --port ${LANDING_PORT}`
      : `pnpm build && pnpm start --port ${LANDING_PORT}`,
    url: `${baseURL}/robots.txt`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
  },

  // Static pages: one engine checks the markup; the app project runs the
  // five-engine matrix on the shared kit.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

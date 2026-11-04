import { test as base, expect, type Page } from "@playwright/test";

const MOCK_API_URL = "http://127.0.0.1:8181";

/** Origin the app under test is served from (playwright.config.ts WEB_PORT). */
export const WEB_ORIGIN = `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? 3100}`;

export type SeededUser = { email: string; password: string; userId: string };

async function mockPost<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`${MOCK_API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`mock API ${path} -> ${response.status}`);
  }
  return (await response.json()) as T;
}

export const mockApi = {
  seedUser: (
    email: string,
    tasks = 25,
    options: { roles?: string[]; notifications?: number } = {},
  ) => mockPost<SeededUser>("/__test/seed", { email, tasks, ...options }),
  /** The access token stops working; the refresh token still does. */
  expireAccessToken: (email: string) =>
    mockPost("/__test/expire-access", { email }),
  /** The whole session is revoked server-side. */
  revokeSession: (email: string) =>
    mockPost("/__test/revoke-session", { email }),
};

/**
 * Signs in on the mock identity provider: from the app's home page, follows
 * "Sign in" (OIDC Authorization Code + PKCE redirect), fills the IdP's own
 * login form and submits it. The browser comes back through /api/auth/callback.
 */
export async function logIn(page: Page, user: SeededUser) {
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await submitIdpForm(page, user.email, user.password, "Continue");
}

export async function submitIdpForm(
  page: Page,
  email: string,
  password: string,
  button: "Continue" | "Register",
) {
  await expect(page).toHaveURL(/127\.0\.0\.1:8181\/oidc\/authorize/);
  await page.getByLabel("IdP email").fill(email);
  await page.getByLabel("IdP password").fill(password);
  await page.getByRole("button", { name: button }).click();
}

/** Signs in through the real redirect flow (so it exercises login + callback). */
export async function signInThroughUi(page: Page, user: SeededUser) {
  await page.goto("/en");
  await logIn(page, user);
  await expect(page).toHaveURL(/\/en\/tasks/);
}

type Fixtures = {
  /**
   * Analytics-consent state the browser starts with. `denied` by default so
   * the (fixed-position) consent banner never covers the controls a test is
   * about to click; the consent spec opts into `unknown` to see the banner.
   */
  consent: "denied" | "unknown";
  /** A user seeded with 25 tasks, unique to this test (safe under parallelism). */
  user: SeededUser;
  /** The same user, already signed in through the UI. */
  signedIn: SeededUser;
  /** A user with the admin role (5 tasks, 3 notifications), signed in. */
  admin: SeededUser;
};

let counter = 0;

export const test = base.extend<Fixtures>({
  consent: ["denied", { option: true }],
  context: async ({ context, consent, baseURL }, use) => {
    if (consent !== "unknown" && baseURL) {
      await context.addCookies([
        { name: "aedst_consent", value: consent, url: baseURL },
      ]);
    }
    await use(context);
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures require destructuring
  user: async ({}, use, testInfo) => {
    counter += 1;
    const email = `e2e-${testInfo.workerIndex}-${counter}-${Date.now()}@example.com`;
    await use(await mockApi.seedUser(email));
  },
  signedIn: async ({ page, user }, use) => {
    await signInThroughUi(page, user);
    await use(user);
  },
  admin: async ({ page }, use, testInfo) => {
    counter += 1;
    const email = `e2e-admin-${testInfo.workerIndex}-${counter}-${Date.now()}@example.com`;
    const admin = await mockApi.seedUser(email, 5, {
      roles: ["user", "admin"],
      notifications: 3,
    });
    await signInThroughUi(page, admin);
    await use(admin);
  },
});

export { expect };

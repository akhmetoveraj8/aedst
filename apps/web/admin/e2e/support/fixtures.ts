import { test as base, expect, type Page } from "@playwright/test";
// The mock API client and the mock IdP form helper are single-sourced in the
// app project (test infrastructure for apps/server's contract).
import {
  mockApi,
  type SeededUser,
  submitIdpForm,
} from "../../../app/e2e/support/fixtures";

export { expect, mockApi, type SeededUser };

/**
 * Signs in through the admin panel's own flow: /api/auth/login redirects to
 * the mock IdP (client `aedst-admin`), the IdP form is submitted, and the
 * browser returns through /api/auth/callback.
 */
export async function signInToAdmin(page: Page, user: SeededUser) {
  await page.goto("/api/auth/login?next=/admin");
  await submitIdpForm(page, user.email, user.password, "Continue");
}

const MOCK_API_URL = "http://127.0.0.1:8181";

/**
 * The titles in a user's notification inbox, read straight from the mock API
 * (the inbox UI belongs to the app project, not the admin panel).
 */
export async function inboxTitles(user: SeededUser): Promise<string[]> {
  const call = async (path: string, body: object, token?: string) => {
    const response = await fetch(`${MOCK_API_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "connect-protocol-version": "1",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`mock API ${path} -> ${response.status}`);
    return response.json();
  };
  const { accessToken } = await call("/__test/token", { email: user.email });
  const { notifications } = await call(
    "/aedst.notifications.v1.NotificationsService/ListNotifications",
    {},
    accessToken,
  );
  return (notifications as { title: string }[]).map((n) => n.title);
}

type Fixtures = {
  /** A plain user (no admin role), signed in. */
  member: SeededUser;
  /** A user with the admin role (5 tasks, 3 notifications), signed in. */
  admin: SeededUser;
};

let counter = 0;

async function seed(
  workerIndex: number,
  label: string,
  roles: string[],
): Promise<SeededUser> {
  counter += 1;
  const email = `e2e-${label}-${workerIndex}-${counter}-${Date.now()}@example.com`;
  return mockApi.seedUser(email, 5, { roles, notifications: 3 });
}

export const test = base.extend<Fixtures>({
  member: async ({ page }, use, testInfo) => {
    const user = await seed(testInfo.workerIndex, "member", ["user"]);
    await signInToAdmin(page, user);
    await use(user);
  },
  admin: async ({ page }, use, testInfo) => {
    const user = await seed(testInfo.workerIndex, "admin", ["user", "admin"]);
    await signInToAdmin(page, user);
    await expect(page).toHaveURL(/\/admin/);
    await use(user);
  },
});

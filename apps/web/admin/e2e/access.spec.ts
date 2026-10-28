import { expect, test } from "./support/fixtures";

/** Who gets into the admin panel: anonymous, signed-in non-admin, admin. */

test.describe("anonymous visitor", () => {
  test("is sent to the admin sign-in route, then the identity provider", async ({
    page,
  }) => {
    await page.goto("/en/admin");
    await expect(page).toHaveURL(/127\.0\.0\.1:8181\/oidc\/authorize/);
    await expect(page.getByLabel("IdP email")).toBeVisible();
  });
});

test.describe("signed-in user without the admin role", () => {
  test("gets the forbidden page, not the panel", async ({ page, member }) => {
    expect(member.email).toBeTruthy();
    await page.goto("/en/admin");
    await expect(page).toHaveURL(/\/en\/forbidden$/);
    await expect(
      page.getByRole("heading", { name: "You don’t have access" }),
    ).toBeVisible();
  });
});

test.describe("admin", () => {
  test("lands on the overview after signing in", async ({ page, admin }) => {
    expect(admin.email).toBeTruthy();
    await page.goto("/en/admin");
    await expect(
      page.getByRole("heading", { name: "Administration" }),
    ).toBeVisible();
  });
});

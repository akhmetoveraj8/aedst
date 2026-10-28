import { expect, test } from "@playwright/test";

test("redirects to the default locale and renders the sign-in landing page", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/en\/?$/);
  await expect(
    page.getByRole("heading", { name: "AEDST", level: 1 }),
  ).toBeVisible();
});

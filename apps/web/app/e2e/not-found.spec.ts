import { expect, test } from "@playwright/test";

test("shows a localized 404 page for unknown routes", async ({ page }) => {
  const response = await page.goto("/en/this-route-does-not-exist");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
});

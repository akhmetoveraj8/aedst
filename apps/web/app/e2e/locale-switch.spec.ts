import { expect, test } from "@playwright/test";

test("switching to Arabic on the sign-in page flips the document to RTL", async ({
  page,
}) => {
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "العربية" }).click();

  await expect(page).toHaveURL(/\/ar\/?$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
});

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";

/**
 * axe at WCAG 2.2 AA on the main admin screens, in both directions and both
 * themes: staff are users too. Same pattern as ../app/e2e/accessibility.spec.ts.
 */
async function expectNoViolations(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  // axe reads computed colours; freeze transitions so it never samples a
  // control halfway through fading in (a false contrast failure).
  await page.addStyleTag({
    content:
      "*,*::before,*::after{transition:none!important;animation:none!important}",
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

/** The section's `h1` is up and no skeleton is left: the data has rendered. */
async function settled(page: Page) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test.describe("admin screens", () => {
  test("overview", async ({ page, admin }) => {
    expect(admin.email).toBeTruthy();
    await page.goto("/en/admin");
    await settled(page);
    await expect(page.getByRole("group").first()).toHaveText(/\d/);
    await expectNoViolations(page);
  });

  test("task directory", async ({ page, admin }) => {
    expect(admin.email).toBeTruthy();
    await page.goto("/en/admin/tasks");
    await settled(page);
    await expect(
      page.getByRole("row", { name: /Seed task/ }).first(),
    ).toBeVisible();
    await expectNoViolations(page);
  });

  test("delete dialog with a validation error", async ({ page, admin }) => {
    expect(admin.email).toBeTruthy();
    await page.goto("/en/admin/tasks");
    await page
      .getByRole("row", { name: /Seed task/ })
      .first()
      .getByRole("button", { name: "Delete" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason").fill("x");
    await dialog.getByRole("button", { name: "Delete task" }).click();
    await expect(
      dialog.getByText("Give a reason of 3 to 500 characters."),
    ).toBeVisible();
    await expectNoViolations(page);
  });

  test("broadcast form with validation errors", async ({ page, admin }) => {
    expect(admin.email).toBeTruthy();
    await page.goto("/en/admin/broadcast");
    await settled(page);
    await page.getByLabel("Link").fill("https://evil.example");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(
      page.getByText("Use an in-app path starting with /."),
    ).toBeVisible();
    await expectNoViolations(page);
  });

  test("audit log", async ({ page, admin }) => {
    expect(admin.email).toBeTruthy();
    await page.goto("/en/admin/audit");
    await settled(page);
    await expectNoViolations(page);
  });

  test("overview in the dark theme", async ({ page, admin }) => {
    expect(admin.email).toBeTruthy();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/en/admin");
    await settled(page);
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expectNoViolations(page);
  });
});

test.describe("right-to-left", () => {
  for (const path of ["/ar/admin", "/ar/admin/tasks", "/ar/admin/broadcast"]) {
    test(`${path} has no violations either`, async ({ page, admin }) => {
      expect(admin.email).toBeTruthy();
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await settled(page);
      await expectNoViolations(page);
    });
  }
});

test.describe("without access", () => {
  test("the forbidden page has no violations", async ({ page, member }) => {
    expect(member.email).toBeTruthy();
    await page.goto("/en/admin");
    await expect(page).toHaveURL(/\/en\/forbidden$/);
    await expectNoViolations(page);
  });
});

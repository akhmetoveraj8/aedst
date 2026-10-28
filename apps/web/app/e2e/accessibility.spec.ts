import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, logIn, test } from "./support/fixtures";

async function expectNoViolations(page: Page) {
  // Metadata is streamed: right after a client-side navigation the <title>
  // can lag the content by a moment. Audit the settled page.
  await expect(page).toHaveTitle(/\S/);
  // axe reads computed colours; freeze transitions so it never samples a
  // control halfway through fading in (a false contrast failure).
  await page.addStyleTag({
    content:
      "*,*::before,*::after{transition:none!important;animation:none!important}",
  });
  // Let webfonts and any in-flight paint settle so colours are final.
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

test.describe("public pages", () => {
  test("home / sign-in form has no accessibility violations", async ({
    page,
  }) => {
    await page.goto("/en");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("a failed sign-in explains itself accessibly", async ({ page }) => {
    await page.goto("/en?auth_error=invalid");
    await expect(page.locator("p[role=alert]")).toContainText(
      "Sign-in could not be verified",
    );
    await expectNoViolations(page);
  });

  test("the right-to-left locale has no violations either", async ({
    page,
  }) => {
    await page.goto("/ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expectNoViolations(page);
  });

  test("the 404 page has no violations", async ({ page }) => {
    await page.goto("/en/this-route-does-not-exist");
    await expectNoViolations(page);
  });

  test("dark theme keeps sufficient contrast", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/en");
    await expectNoViolations(page);
  });
});

test.describe("signed-in pages", () => {
  test("dashboard and task list", async ({ page, signedIn }) => {
    expect(signedIn.email).toBeTruthy();
    await expect(
      page.getByRole("link", { name: /Seed task 25/ }),
    ).toBeVisible();
    await expectNoViolations(page);
  });

  test("dashboard in the dark theme", async ({ page, user }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/en");
    await logIn(page, user);
    await expect(
      page.getByRole("link", { name: /Seed task 25/ }),
    ).toBeVisible();
    await expectNoViolations(page);
  });

  test("empty and filtered-empty states", async ({ page, signedIn }) => {
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en/tasks?q=zzz-nothing-matches");
    // Scoped to the visible list: while a streamed Suspense segment is being
    // revealed, React briefly keeps a hidden copy in the document.
    await expect(
      page
        .getByRole("region", { name: "Tasks" })
        .getByText("No matching tasks"),
    ).toBeVisible();
    await expectNoViolations(page);
  });

  test("create-task form", async ({ page, signedIn }) => {
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en/tasks/new");
    await expect(page.getByLabel("Title")).toBeVisible();
    await expectNoViolations(page);
  });

  test("create-task form with validation errors", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en/tasks/new");
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText("Title is required.")).toBeVisible();
    await expectNoViolations(page);
  });

  test("task details", async ({ page, signedIn }) => {
    expect(signedIn.email).toBeTruthy();
    await page.getByRole("link", { name: /Seed task 25/ }).click();
    await expect(
      page.getByRole("heading", { name: "Seed task 25" }),
    ).toBeVisible();
    await expectNoViolations(page);
  });

  test("delete confirmation dialog", async ({ page, signedIn }) => {
    expect(signedIn.email).toBeTruthy();
    await page.getByRole("link", { name: /Seed task 25/ }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expectNoViolations(page);
  });

  test("the task list works with the keyboard alone", async ({
    page,
    browserName,
    signedIn,
  }) => {
    test.skip(
      browserName === "webkit",
      "Safari only tabs to text fields by default (buttons need Option+Tab)",
    );
    expect(signedIn.email).toBeTruthy();
    await expect(
      page.getByRole("link", { name: /Seed task 25/ }),
    ).toBeVisible();

    await page.getByRole("searchbox", { name: "Search tasks" }).focus();
    await page.keyboard.type("Seed task 03");
    await expect(
      page.getByRole("region", { name: "Tasks" }).getByRole("listitem"),
    ).toHaveCount(1);

    await page.keyboard.press("Tab"); // status filter
    await page.keyboard.press("Tab"); // priority filter
    await page.keyboard.press("Tab"); // sort
    await page.keyboard.press("Tab"); // "New task"
    await expect(page.getByRole("link", { name: "New task" })).toBeFocused();
  });
});

import type { Page } from "@playwright/test";

import { expect, logIn, test } from "./support/fixtures";

// These run on every project, so the touch phones (Pixel 7, iPhone 14) and the
// desktop engines all exercise the same assertions at their own viewport.

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test.describe("layout at the project's viewport", () => {
  test("sign-in form fits without horizontal scrolling", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("dashboard and task list fit without horizontal scrolling", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await expect(
      page.getByRole("link", { name: /Seed task 25/ }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("every list control is reachable and usable", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();

    for (const control of [
      page.getByRole("searchbox", { name: "Search tasks" }),
      page.getByRole("combobox", { name: "Filter by status" }),
      page.getByRole("combobox", { name: "Filter by priority" }),
      page.getByRole("combobox", { name: "Sort tasks" }),
      page.getByRole("link", { name: "New task" }),
    ]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
    }

    await page.getByRole("combobox", { name: "Filter by status" }).click();
    await page.getByRole("option", { name: "Done" }).click();
    await expect(page).toHaveURL(/status=done/);
  });

  test("the task form is usable end to end", async ({ page, signedIn }) => {
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en/tasks/new");
    await expectNoHorizontalOverflow(page);

    // Wait for hydration first (see logIn in fixtures for why).
    await expect(
      page.getByRole("button", { name: "Create task" }),
    ).toBeEnabled();
    await page.getByLabel("Title").fill("Made on a small screen");
    await page.getByRole("button", { name: "Create task" }).click();

    await expect(
      page.getByRole("heading", { name: "Made on a small screen" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("pagination controls stay on screen", async ({ page, signedIn }) => {
    expect(signedIn.email).toBeTruthy();
    const next = page.getByRole("button", { name: "Next", exact: true });
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeInViewport();
  });

  test("the right-to-left locale fits too", async ({ page }) => {
    await page.goto("/ar");
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("very narrow screens", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test("sign-in and dashboard survive a 320px viewport", async ({
    page,
    user,
  }) => {
    await page.goto("/en");
    await expectNoHorizontalOverflow(page);

    await logIn(page, user);
    await expect(
      page.getByRole("link", { name: /Seed task 25/ }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("interactive targets are large enough to tap", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await expect(
      page.getByRole("link", { name: /Seed task 25/ }),
    ).toBeVisible();

    const box = await page
      .getByRole("link", { name: /Seed task 25/ })
      .boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

test.describe("zoom and text size", () => {
  test("content reflows at 200% zoom (WCAG 1.4.4/1.4.10)", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.setViewportSize({ width: 640, height: 720 });
    await expect(
      page.getByRole("link", { name: /Seed task 25/ }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

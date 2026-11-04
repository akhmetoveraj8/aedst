import { expect, test } from "./support/fixtures";

/**
 * The global modules around Tasks — search, notifications, media, admin —
 * end to end against the mock API (e2e/mock-api), through the real BFF.
 */

test.describe("search", () => {
  test("finds tasks from the search page with highlighted matches, state in the URL", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en/search");
    // Text typed before hydration is reset when React takes over the
    // controlled input; retry until it is live.
    await expect(async () => {
      const box = page.getByLabel("Search everything");
      await box.fill(""); // refilling the same value fires no input event
      await box.fill("Seed task 07");
      await expect(page).toHaveURL(/q=Seed\+task\+07|q=Seed%20task%2007/, {
        timeout: 1_500,
      });
    }).toPass();
    const result = page.getByRole("link", { name: /Seed task 07/ });
    await expect(result).toBeVisible();
    await expect(result.locator("mark").first()).toHaveText(/seed task 07/i);

    await result.click();
    await expect(page).toHaveURL(/\/en\/tasks\/[0-9a-f-]+$/);
  });

  test("opens the command palette with the keyboard and jumps to a result", async ({
    page,
    signedIn,
    isMobile,
  }) => {
    test.skip(isMobile, "keyboard shortcut is a desktop affordance");
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en/tasks");
    const dialog = page.getByRole("dialog");
    // The shortcut listener attaches on hydration; retry until it is live.
    await expect(async () => {
      await page.keyboard.press("ControlOrMeta+k");
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await dialog.getByRole("combobox").fill("Seed task 03");
    // The hit itself, not the "Search for …" option below it.
    await dialog
      .getByRole("option", { name: "Seed task 03", exact: true })
      .click();
    await expect(page).toHaveURL(/\/en\/tasks\/[0-9a-f-]+$/);
  });
});

test.describe("notifications", () => {
  test("shows unread count, opens the inbox and marks everything read", async ({
    page,
    admin,
  }) => {
    expect(admin.email).toBeTruthy();
    const bell = page.getByRole("link", { name: /Notifications, 3 unread/ });
    await expect(bell).toBeVisible();
    await bell.click();

    await expect(page).toHaveURL(/\/en\/notifications$/);
    await expect(page.getByText("Seed notification 1")).toBeVisible();
    await page.getByRole("button", { name: "Mark all as read" }).click();

    // The bell drops its unread count.
    await expect(page.getByRole("link", { name: /unread/ })).toHaveCount(0);
  });

  test("completing a task produces a notification", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.getByRole("link", { name: /Seed task 25/ }).click();
    await page.getByRole("button", { name: "Mark complete" }).click();
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();

    await page.goto("/en/notifications");
    await expect(page.getByText("Task completed")).toBeVisible();
  });

  test("saves notification preferences", async ({ page, signedIn }) => {
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en/notifications/preferences");
    const toggle = page.getByRole("switch", { name: "A task is due soon" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(page.getByText("Preferences saved")).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("switch", { name: "A task is due soon" }),
    ).not.toBeChecked();
  });
});

test.describe("media", () => {
  test("uploads an attachment to a task through a presigned URL", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.getByRole("link", { name: /Seed task 24/ }).click();
    await expect(
      page.getByRole("heading", { name: "Attachments" }),
    ).toBeVisible();

    await page.getByLabel(/Drop files here/).setInputFiles({
      name: "notes.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 mock"),
    });

    await expect(page.getByText("Uploaded")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open notes.pdf" }),
    ).toBeVisible();
  });
});

test.describe("authorization", () => {
  test("a regular user sees no admin link (the admin panel is its own project)", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  });
});

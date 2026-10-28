import { expect, mockApi, signInThroughUi, test } from "./support/fixtures";

/**
 * Notifications inbox end to end against the mock API: unread/all filter in
 * the URL, opening one marks it read and follows its link, paging, and the
 * empty state.
 */

test.describe("notifications inbox", () => {
  test("shows the all-caught-up state for a user without notifications", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en/notifications");

    await expect(page.getByText("You’re all caught up")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mark all as read" }),
    ).toBeDisabled();
  });

  test("filters to unread, keeping the filter in the URL", async ({
    page,
    admin,
  }) => {
    expect(admin.email).toBeTruthy();
    await page.goto("/en/notifications");
    const list = page.getByRole("list", { name: "Notifications" });
    await expect(list.getByRole("listitem")).toHaveCount(3);

    // Reading one leaves two unread.
    await list.getByRole("button", { name: /Seed notification 1/ }).click();
    await expect(page).toHaveURL(/\/en\/tasks/);

    await page.goto("/en/notifications");
    await page.getByRole("tab", { name: "Unread" }).click();
    await expect(page).toHaveURL(/unread=true/);
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByText("Seed notification 1")).toHaveCount(0);

    await page.getByRole("tab", { name: "All" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(3);
  });

  test("opening a notification marks it read and follows its link", async ({
    page,
    admin,
  }) => {
    expect(admin.email).toBeTruthy();
    await expect(
      page.getByRole("link", { name: /Notifications, 3 unread/ }),
    ).toBeVisible();

    await page.goto("/en/notifications");
    await page.getByRole("button", { name: /Seed notification 2/ }).click();

    // The seeded link is /tasks; the bell now counts one fewer.
    await expect(page).toHaveURL(/\/en\/tasks$/);
    await expect(
      page.getByRole("link", { name: /Notifications, 2 unread/ }),
    ).toBeVisible();
  });

  test("pages through a long inbox with Load more", async ({ page }) => {
    // 25 notifications: one page of 20, then the rest.
    const user = await mockApi.seedUser(
      `e2e-inbox-${Date.now()}@example.com`,
      1,
      {
        notifications: 25,
      },
    );
    await signInThroughUi(page, user);

    await page.goto("/en/notifications");
    const items = page
      .getByRole("list", { name: "Notifications" })
      .getByRole("listitem");
    // The list is virtualized: only the rows in view are in the DOM, and the
    // set size is unknown (-1) while another page exists.
    await expect(items.first()).toHaveAttribute("aria-setsize", "-1");

    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(
      0,
    );
    // All 25 are loaded now, so the set size is known.
    await expect(items.first()).toHaveAttribute("aria-setsize", "25");
  });

  test("requires a signed-in user", async ({ page }) => {
    await page.goto("/en/notifications");
    await expect(page).toHaveURL(/\/en(\?|$)/);
  });
});

test.describe("notification preferences", () => {
  test("each preference switch persists independently", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en/notifications/preferences");

    const taskCompleted = page.getByRole("switch", {
      name: "A task is completed",
    });
    const mediaReady = page.getByRole("switch", {
      name: "An upload finished processing",
    });
    await expect(taskCompleted).toBeChecked();
    await expect(mediaReady).toBeChecked();

    await taskCompleted.click();
    await expect(page.getByText("Preferences saved")).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("switch", { name: "A task is completed" }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("switch", { name: "An upload finished processing" }),
    ).toBeChecked();
  });
});

import { expect, inboxTitles, mockApi, test } from "./support/fixtures";

/**
 * The admin area end to end against the mock API: overview metrics, the task
 * directory, the audited reason-required delete, and a broadcast that
 * a different user actually receives.
 */

test.describe("admin overview and directories", () => {
  test("the overview shows the platform metrics", async ({ page, admin }) => {
    expect(admin.email).toBeTruthy();
    await page.goto("/en/admin");

    await expect(
      page.getByRole("heading", { name: "Administration" }),
    ).toBeVisible();
    for (const metric of [
      "Tasks",
      "Completed tasks",
      "Overdue tasks",
      "Files",
      "Storage used",
      "Push devices",
    ]) {
      await expect(
        page.getByText(metric, { exact: true }).first(),
      ).toBeVisible();
    }
    // The admin's own 5 seeded tasks are part of the totals; the counter has
    // resolved (a skeleton is not text).
    await expect(page.getByRole("group").first()).toHaveText(/\d/);
  });

  test("the admin navigation reaches every section", async ({
    page,
    admin,
  }) => {
    expect(admin.email).toBeTruthy();
    await page.goto("/en/admin");

    for (const [link, url] of [
      ["All tasks", /\/admin\/tasks$/],
      ["Broadcast", /\/admin\/broadcast$/],
      ["Audit log", /\/admin\/audit$/],
      ["Overview", /\/admin$/],
    ] as const) {
      await page
        .getByRole("navigation", { name: "Administration sections" })
        .getByRole("link", { name: link, exact: true })
        .click();
      await expect(page).toHaveURL(url);
    }
  });

  test("lists tasks across users and filters them by title", async ({
    page,
    admin,
  }) => {
    expect(admin.email).toBeTruthy();
    await page.goto("/en/admin/tasks");

    await page.getByLabel("Search by title").fill("Seed task 03");
    await expect(
      page.getByRole("row", { name: /Seed task 03/ }).first(),
    ).toBeVisible();

    await page.getByLabel("Search by title").fill("no-such-task-title");
    await expect(page.getByText("No tasks found.")).toBeVisible();
  });
});

test.describe("audited actions", () => {
  test("a delete needs a real reason, and the reason lands in the audit log", async ({
    page,
    admin,
  }) => {
    expect(admin.email).toBeTruthy();
    await page.goto("/en/admin/tasks");
    await page.getByLabel("Search by title").fill("Seed task 02");
    await page
      .getByRole("row", { name: /Seed task 02/ })
      .first()
      .getByRole("button", { name: "Delete" })
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason").fill("x");
    await dialog.getByRole("button", { name: "Delete task" }).click();
    await expect(
      dialog.getByText("Give a reason of 3 to 500 characters."),
    ).toBeVisible();

    await dialog.getByLabel("Reason").fill("duplicate of another task");
    await dialog.getByRole("button", { name: "Delete task" }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/en/admin/audit");
    const entry = page
      .getByRole("row", { name: /task\.delete/ })
      .filter({ hasText: "duplicate of another task" });
    await expect(entry.first()).toBeVisible();
  });

  test("cancelling the delete dialog changes nothing", async ({
    page,
    admin,
  }) => {
    expect(admin.email).toBeTruthy();
    await page.goto("/en/admin/tasks");
    await page.getByLabel("Search by title").fill("Seed task 04");
    await page
      .getByRole("row", { name: /Seed task 04/ })
      .first()
      .getByRole("button", { name: "Delete" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel" })
      .click();

    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(
      page.getByRole("row", { name: /Seed task 04/ }).first(),
    ).toBeVisible();
  });
});

test.describe("audit log", () => {
  test("lists the delete with its actor and reason", async ({
    page,
    admin,
  }) => {
    await page.goto("/en/admin/tasks");
    await page.getByLabel("Search by title").fill("Seed task 03");
    await page
      .getByRole("row", { name: /Seed task 03/ })
      .first()
      .getByRole("button", { name: "Delete" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason").fill("audit trail check");
    await dialog.getByRole("button", { name: "Delete task" }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/en/admin/audit");
    const entry = page
      .getByRole("row", { name: /task\.delete/ })
      .filter({ hasText: "audit trail check" });
    await expect(entry.first()).toBeVisible();
    await expect(entry.first()).toContainText(admin.userId.slice(0, 8));
  });
});

test.describe("broadcast", () => {
  test("an admin's broadcast reaches the targeted user's inbox", async ({
    page,
    admin,
  }) => {
    expect(admin.email).toBeTruthy();
    const recipient = await mockApi.seedUser(
      `e2e-recipient-${Date.now()}@example.com`,
      1,
    );

    await page.goto("/en/admin/broadcast");
    // Values typed before hydration can be reset when React takes over the
    // form: wait for the page to settle and check the first one sticks.
    await page.waitForLoadState("networkidle");
    const userId = page.getByLabel("User ID");
    await expect(async () => {
      await userId.fill(recipient.userId);
      await page.waitForTimeout(300);
      await expect(userId).toHaveValue(recipient.userId, { timeout: 500 });
    }).toPass();
    await page.getByLabel("Title").fill("Scheduled maintenance");
    await page.getByLabel("Message").fill("Back in ten minutes.");
    await page.getByLabel("Link").fill("/tasks");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Sent to 1 user")).toBeVisible();

    // The recipient's inbox (read from the mock API) holds it.
    await expect
      .poll(() => inboxTitles(recipient))
      .toContain("Scheduled maintenance");
  });

  test("rejects an off-site link before sending", async ({ page, admin }) => {
    expect(admin.email).toBeTruthy();
    await page.goto("/en/admin/broadcast");

    await page.getByLabel("Title").fill("Hello");
    await page.getByLabel("Link").fill("https://evil.example");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(
      page.getByText("Use an in-app path starting with /."),
    ).toBeVisible();
  });
});

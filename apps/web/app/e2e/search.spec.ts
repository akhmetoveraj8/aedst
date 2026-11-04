import { expect, test } from "./support/fixtures";

/**
 * Full-page search end to end against the mock API: the empty prompt, kind
 * filter in the URL, no-results state, files found by name, and paging.
 */

async function typeQuery(page: import("@playwright/test").Page, query: string) {
  // Text typed before hydration is reset when React takes over the controlled
  // input; retry until the URL reflects it (i.e. the handler is live).
  await expect(async () => {
    // Clear first: filling the value the DOM already holds fires no input
    // event, so a retry could never reach a handler that came alive late.
    const box = page.getByLabel("Search everything");
    await box.fill("");
    await box.fill(query);
    await expect(page).toHaveURL(/[?&]q=/, { timeout: 1_500 });
  }).toPass();
}

test.describe("search page", () => {
  test("prompts for a query before anything is typed", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en/search");

    await expect(
      page.getByText("Type to search your tasks and files."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Seed task/ })).toHaveCount(0);
  });

  test("shows an empty state when nothing matches", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en/search");
    await typeQuery(page, "zzz-no-such-thing");

    await expect(page.getByText("Nothing found")).toBeVisible();
    await expect(
      page.getByText("Try different words or another filter."),
    ).toBeVisible();
  });

  test("counts results and lets the type filter narrow them, kept in the URL", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en/search");
    await typeQuery(page, "Seed task 1");

    // "Seed task 10" ... "Seed task 19" of the 25 seeded tasks.
    await expect(
      page.getByRole("status").filter({ hasText: /result/ }),
    ).toContainText("10 results");

    await page.getByRole("tab", { name: "Files" }).click();
    await expect(page).toHaveURL(/kind=media/);
    await expect(page.getByText("Nothing found")).toBeVisible();

    await page.getByRole("tab", { name: "Tasks" }).click();
    await expect(page).toHaveURL(/kind=task/);
    await expect(
      page.getByRole("link", { name: /Seed task 10/ }),
    ).toBeVisible();
  });

  test("finds an uploaded file by name and links back to its task", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.getByRole("link", { name: /Seed task 23/ }).click();
    await page.getByLabel(/Drop files here/).setInputFiles({
      name: "quarterly-report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 mock"),
    });
    await expect(page.getByText("Uploaded")).toBeVisible();

    await page.goto("/en/search?kind=media");
    await typeQuery(page, "quarterly");

    const hit = page.getByRole("link", { name: /quarterly-report\.pdf/ });
    await expect(hit).toBeVisible();
    await expect(hit.getByText("Files")).toBeVisible();
    await hit.click();
    await expect(page).toHaveURL(/\/en\/tasks\/[0-9a-f-]+$/);
  });

  test("restores the query and filter from the URL on load", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en/search?q=Seed+task+07&kind=task");

    await expect(page.getByLabel("Search everything")).toHaveValue(
      "Seed task 07",
    );
    await expect(page.getByRole("tab", { name: "Tasks" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByRole("link", { name: /Seed task 07/ }),
    ).toBeVisible();
  });

  test("requires a signed-in user", async ({ page }) => {
    await page.goto("/en/search");
    await expect(page).toHaveURL(/\/en(\?|$)/);
    await expect(page.getByLabel("Search everything")).toHaveCount(0);
  });
});

import { expect, logIn, test } from "./support/fixtures";

test.describe("server-rendered data", () => {
  test("the first HTML response already contains the dashboard and the task list", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();

    // Same cookies as the signed-in page, but no JavaScript: if the data is in
    // this HTML it was prefetched on the server and hydrated, not fetched by
    // the browser after load.
    const response = await page.request.get("/en/tasks");
    const html = await response.text();

    expect(response.status()).toBe(200);
    expect(html).toContain("Total tasks");
    expect(html).toContain("Seed task 25");
    expect(html).toContain(signedIn.email); // <CurrentUser/> is a Server Component
  });

  test("does not refetch on load what the server already prefetched", async ({
    page,
    user,
  }) => {
    const calls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/rpc/")) {
        calls.push(request.url().split("/api/rpc/")[1] ?? "");
      }
    });
    await page.goto("/en");
    await logIn(page, user);
    await expect(page.getByText("Seed task 25")).toBeVisible();

    // Hydrated data is fresh (60s staleTime): no client request on landing.
    expect(calls).toEqual([]);
  });
});

test.describe("dashboard", () => {
  test("shows aggregate counts", async ({ page, signedIn }) => {
    expect(signedIn.email).toBeTruthy();

    await expect(page.getByText("Total tasks")).toBeVisible();
    const total = page
      .locator("[data-slot='card']")
      .filter({ hasText: "Total tasks" });
    await expect(total).toContainText("25");
  });
});

test.describe("list state lives in the URL", () => {
  test("search is debounced and reflected in the URL", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("ListTasks")) {
        requests.push(request.postData() ?? "");
      }
    });

    const box = page.getByRole("searchbox", { name: "Search tasks" });
    await box.pressSequentially("Seed task 07", { delay: 30 });

    await expect(page).toHaveURL(/q=Seed\+task\+07|q=Seed%20task%2007/);
    await expect(
      page.getByRole("region", { name: "Tasks" }).getByRole("listitem"),
    ).toHaveCount(1);
    // One request for the finished text, not one per keystroke (12 keys).
    expect(requests.length).toBeLessThanOrEqual(2);
  });

  test("filters survive a reload and can be shared as a link", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();

    await page.getByRole("combobox", { name: "Filter by status" }).click();
    await page.getByRole("option", { name: "Done" }).click();
    await expect(page).toHaveURL(/status=done/);

    await page.reload();
    await expect(page).toHaveURL(/status=done/);
    await expect(
      page.getByRole("combobox", { name: "Filter by status" }),
    ).toContainText("Done");
    for (const badge of await page
      .getByRole("list")
      .getByText("Status: Done")
      .all()) {
      await expect(badge).toBeVisible();
    }
    await expect(page.getByText("Status: Todo")).toHaveCount(0);

    // A second visitor (same session here) opening the same link sees the same view.
    await page.goto("/en/tasks?status=done&priority=high");
    await expect(
      page.getByRole("combobox", { name: "Filter by priority" }),
    ).toContainText("High");
  });

  test("pagination keeps its place across a reload, and Previous works afterwards", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    // Scoped to the visible list (see accessibility.spec.ts: a streamed
    // segment briefly has a hidden copy while React reveals it).
    const list = page.getByRole("region", { name: "Tasks" });

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/cursors=/);
    await expect(list.getByText("Seed task 05")).toBeVisible();
    await expect(list.getByText("Seed task 25")).toHaveCount(0);

    await page.reload();
    await expect(list.getByText("Seed task 05")).toBeVisible();

    await page.getByRole("button", { name: "Previous" }).click();
    await expect(list.getByText("Seed task 25")).toBeVisible();
    await expect(page).not.toHaveURL(/cursors=/);
  });

  test("browser Back returns to the previous page of results", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Seed task 05")).toBeVisible();

    await page.goBack();
    await expect(page.getByText("Seed task 25")).toBeVisible();
  });
});

test.describe("task CRUD", () => {
  test("creates a task, opens it, completes it and deletes it", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();

    await page.getByRole("link", { name: "New task" }).click();
    await page.getByLabel("Title").fill("Write the e2e suite");
    await page.getByRole("button", { name: "Create task" }).click();

    await expect(
      page.getByRole("heading", { name: "Write the e2e suite" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Mark complete" }).click();
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();

    await expect(page).toHaveURL(/\/en\/tasks$/);
    await expect(page.getByText("Write the e2e suite")).toHaveCount(0);
  });

  test("shows 'not found' for a task that does not exist", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();

    await page.goto("/en/tasks/00000000-0000-4000-8000-00000000ffff");

    await expect(page.getByText("Task not found")).toBeVisible();
  });
});

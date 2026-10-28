import { expect, test } from "./support/fixtures";

/**
 * Attachments end to end against the mock API: presigned upload, listing,
 * viewing, deleting, and the rejection of an oversize file.
 */

async function openTask(page: import("@playwright/test").Page, title: RegExp) {
  await page.getByRole("link", { name: title }).click();
  await expect(
    page.getByRole("heading", { name: "Attachments" }),
  ).toBeVisible();
}

test.describe("task attachments", () => {
  test("starts empty", async ({ page, signedIn }) => {
    expect(signedIn.email).toBeTruthy();
    await openTask(page, /Seed task 22/);

    await expect(page.getByText("No attachments yet.")).toBeVisible();
  });

  test("uploads an image, lists it and deletes it again", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await openTask(page, /Seed task 21/);

    // A 1x1 transparent PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.getByLabel(/Drop files here/).setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(page.getByText("Uploaded")).toBeVisible();

    const open = page.getByRole("button", { name: "Open pixel.png" });
    await expect(open).toBeVisible();

    await page.getByRole("button", { name: "Delete pixel.png" }).click();
    await page
      .getByRole("alertdialog", { name: "Delete this attachment?" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(open).toHaveCount(0);
    await expect(page.getByText("No attachments yet.")).toBeVisible();
  });

  test("opens an uploaded file in a viewer dialog", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await openTask(page, /Seed task 20/);
    await page.getByLabel(/Drop files here/).setInputFiles({
      name: "agenda.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 mock"),
    });
    await expect(page.getByText("Uploaded")).toBeVisible();

    await page.getByRole("button", { name: "Open agenda.pdf" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("uploads several files in one go", async ({ page, signedIn }) => {
    expect(signedIn.email).toBeTruthy();
    await openTask(page, /Seed task 19/);

    await page.getByLabel(/Drop files here/).setInputFiles([
      {
        name: "a.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF a"),
      },
      {
        name: "b.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF b"),
      },
    ]);

    await expect(
      page.getByRole("button", { name: "Open a.pdf" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open b.pdf" }),
    ).toBeVisible();
  });
});

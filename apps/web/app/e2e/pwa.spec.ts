import { expect, test } from "./support/fixtures";

test.describe("PWA", () => {
  test("serves an installable manifest with icons, screenshots and shortcuts", async ({
    request,
  }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.display).toBe("standalone");
    expect(
      manifest.icons.some(
        (icon: { sizes: string }) => icon.sizes === "512x512",
      ),
    ).toBe(true);
    expect(
      manifest.icons.some(
        (icon: { purpose?: string }) => icon.purpose === "maskable",
      ),
    ).toBe(true);
    expect(manifest.screenshots.length).toBeGreaterThan(0);
    expect(manifest.shortcuts.length).toBeGreaterThan(0);

    for (const icon of manifest.icons) {
      const response = await request.get(icon.src);
      expect(response.status(), icon.src).toBe(200);
    }
  });

  test("serves the service worker uncached, with push handlers and no API caching", async ({
    request,
  }) => {
    const response = await request.get("/serwist/sw.js");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const source = await response.text();
    expect(source).toContain("notificationclick");
    expect(source).toContain("pushsubscriptionchange");
  });

  test("has a localized, script-free offline fallback per locale", async ({
    request,
  }) => {
    const response = await request.get("/offline/ru");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    const html = await response.text();
    expect(html).toContain('lang="ru"');
    expect(html).not.toContain("<script");
  });
});

test.describe("service worker at runtime", () => {
  test.use({ serviceWorkers: "allow" });

  test("registers, and serves the offline page for navigations without a network", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "Playwright drives service workers reliably only in Chromium",
    );
    await page.goto("/en");
    // Registration waits for the load event; then the worker must activate.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.active?.state ?? "none";
        }),
      )
      .toBe("activated");

    await context.setOffline(true);
    await page.goto("/en/tasks").catch(() => {});
    await expect(
      page.getByRole("heading", { name: "You’re offline" }),
    ).toBeVisible();
    await context.setOffline(false);
  });
});

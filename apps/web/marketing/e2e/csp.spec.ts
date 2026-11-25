import { expect, test } from "@playwright/test";

import { LOCALES, PAGES, pagePath } from "./support/pages";

/**
 * The static-export security contract (docs/content/web/marketing-static.md):
 * every document carries a CSP whose `script-src` is `'self'` plus SHA-256
 * hashes (never `'unsafe-inline'` or `'unsafe-eval'`), the browser raises no
 * violation while the page hydrates and is used, and the inline theme script
 * (which only runs when its hash matches) still takes effect.
 */

function directive(csp: string, name: string): string {
  return (
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? ""
  );
}

for (const locale of LOCALES) {
  for (const { pathname } of PAGES) {
    const path = pagePath(locale, pathname);

    test(`${path}: hash-based CSP, no violations, theme script runs`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme: "dark" });
      const page = await context.newPage();
      await page.addInitScript(() => {
        // biome-ignore lint/suspicious/noExplicitAny: a test probe on window
        (window as any).__cspViolations = [];
        document.addEventListener("securitypolicyviolation", (event) => {
          // biome-ignore lint/suspicious/noExplicitAny: a test probe on window
          (window as any).__cspViolations.push(
            `${event.violatedDirective} ${event.blockedURI}`,
          );
        });
      });
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });

      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      const csp =
        (await response?.headerValue("content-security-policy")) ?? "";

      const scriptSrc = directive(csp, "script-src");
      expect(scriptSrc).toContain("'self'");
      expect(scriptSrc).toMatch(/'sha256-[A-Za-z0-9+/]+=*'/);
      expect(scriptSrc).not.toContain("unsafe-inline");
      expect(scriptSrc).not.toContain("unsafe-eval");
      expect(directive(csp, "style-src")).toBe("style-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");

      await page.waitForLoadState("networkidle");
      // The inline theme script sets this before first paint, in dark mode.
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);

      expect(
        await page.evaluate(
          // biome-ignore lint/suspicious/noExplicitAny: a test probe on window
          () => (window as any).__cspViolations as string[],
        ),
      ).toEqual([]);
      expect(
        consoleErrors.filter((text) => /content security policy/i.test(text)),
      ).toEqual([]);
      await context.close();
    });
  }
}

test("the language links navigate without a CSP violation", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  await page.goto("/en/privacy");
  await page
    .getByRole("navigation", { name: "Language" })
    .locator('a[hreflang="ru"]')
    .click();
  await expect(page).toHaveURL(/\/ru\/privacy$/);
  expect(violations).toEqual([]);
});

test("/ sends the browser to its language, the default otherwise", async ({
  request,
}) => {
  const tajik = await request.get("/", {
    headers: { "accept-language": "tg-TJ,en;q=0.5" },
    maxRedirects: 0,
  });
  expect(tajik.status()).toBe(302);
  expect(tajik.headers()["location"]).toBe("/tj");
  expect(tajik.headers()["vary"]).toContain("Accept-Language");

  const other = await request.get("/", {
    headers: { "accept-language": "de" },
    maxRedirects: 0,
  });
  expect(other.headers()["location"]).toBe("/en");
});

test("an unknown path answers 404 in the locale of the URL", async ({
  request,
}) => {
  const russian = await request.get("/ru/net-takoj-stranicy");
  expect(russian.status()).toBe(404);
  const html = await russian.text();
  expect(html).toContain('lang="ru"');
  expect(html).toContain("noindex");

  const unlocalized = await request.get("/nope");
  expect(unlocalized.status()).toBe(404);
  expect(await unlocalized.text()).toContain('lang="en"');
});

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * axe at WCAG 2.2 AA on the rendered marketing pages, in both directions and
 * both themes. Same pattern as ../app/e2e/accessibility.spec.ts.
 */
async function expectNoViolations(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  // axe reads computed colours; freeze transitions so it never samples a
  // control halfway through fading in (a false contrast failure).
  await page.addStyleTag({
    content:
      "*,*::before,*::after{transition:none!important;animation:none!important}",
  });
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

for (const path of ["/en", "/en/privacy", "/en/terms"]) {
  test(`${path} has no accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expectNoViolations(page);
  });
}

for (const path of ["/ar", "/ar/privacy"]) {
  test(`${path} (right-to-left) has no violations either`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expectNoViolations(page);
  });
}

test("dark theme keeps sufficient contrast", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/en");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expectNoViolations(page);
});

test("the 404 page has no violations", async ({ page }) => {
  const response = await page.goto("/en/this-route-does-not-exist");
  expect(response?.status()).toBe(404);
  await expectNoViolations(page);
});

test("an open FAQ answer has no violations", async ({ page }) => {
  await page.goto("/en");
  await page.locator("#faq summary").first().click();
  await expect(page.locator("#faq details").first()).toHaveAttribute(
    "open",
    "",
  );
  await expectNoViolations(page);
});

import { expect, test } from "@playwright/test";

// See src/app/styles/globals.css (prefers-reduced-motion). Browsers serialise the
// 0.00001s override differently (`1e-05s` vs `0.00001s`), so compare numbers.
const seconds = (value: string) => Number.parseFloat(value);
test.describe("prefers-reduced-motion: reduce", () => {
  test.use({ reducedMotion: "reduce" });

  test("disables animations, transitions and smooth scrolling", async ({
    page,
  }) => {
    await page.goto("/en");
    await expect(
      page.getByRole("heading", { name: "AEDST", level: 1 }),
    ).toBeVisible();

    const styles = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.animation = "spin 1s infinite";
      probe.style.transition = "opacity 1s";
      document.body.append(probe);
      const computed = getComputedStyle(probe);
      const result = {
        animationDuration: computed.animationDuration,
        transitionDuration: computed.transitionDuration,
        scrollBehavior: getComputedStyle(document.documentElement)
          .scrollBehavior,
      };
      probe.remove();
      return result;
    });

    expect(seconds(styles.animationDuration)).toBeLessThan(0.001);
    expect(seconds(styles.transitionDuration)).toBeLessThan(0.001);
    expect(styles.scrollBehavior).toBe("auto");
  });

  test("animations stay enabled without the preference", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    await page.goto("/en");
    const matches = await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(matches).toBe(false);
    await context.close();
  });
});

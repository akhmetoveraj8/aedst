import { expect, test } from "@playwright/test";

import {
  LANGUAGE_TAGS,
  LOCALES,
  PAGES,
  pagePath,
  SITE_WIDE_TYPES,
} from "./support/pages";

/**
 * The SEO contract of docs/content/web/seo-by-project.md, asserted on the
 * HTML the production server sends for every public page in every locale:
 * canonical, the hreflang set with x-default, og:url equal to the canonical,
 * JSON-LD that parses and carries the expected types, and exactly one h1.
 */

type JsonLdNode = { "@type"?: string };

function jsonLdTypes(documents: string[]): string[] {
  return documents.flatMap((text) => {
    const data = JSON.parse(text) as JsonLdNode & { "@graph"?: JsonLdNode[] };
    return (data["@graph"] ?? [data]).map((node) => node["@type"] ?? "");
  });
}

for (const locale of LOCALES) {
  for (const { pathname, jsonLdTypes: expectedTypes } of PAGES) {
    const path = pagePath(locale, pathname);

    test(`${path}: canonical, hreflang, og:url, JSON-LD and one h1`, async ({
      page,
    }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);

      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        LANGUAGE_TAGS[locale],
      );
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr",
      );

      // Canonical: absolute, self-referencing, exactly one.
      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical).toHaveCount(1);
      const canonicalHref = (await canonical.getAttribute("href")) ?? "";
      const canonicalUrl = new URL(canonicalHref);
      expect(canonicalUrl.pathname).toBe(path);
      expect(canonicalUrl.search).toBe("");

      // hreflang: one alternate per locale plus x-default (the default locale).
      const alternates = await page
        .locator('link[rel="alternate"][hreflang]')
        .evaluateAll((links) =>
          links.map((link) => [
            link.getAttribute("hreflang") ?? "",
            link.getAttribute("href") ?? "",
          ]),
        );
      const expected = [
        ...LOCALES.map((code) => [
          LANGUAGE_TAGS[code],
          new URL(pagePath(code, pathname), canonicalUrl.origin).toString(),
        ]),
        [
          "x-default",
          new URL(pagePath("en", pathname), canonicalUrl.origin).toString(),
        ],
      ];
      expect(alternates.toSorted()).toEqual(expected.toSorted());

      // og:url is the canonical of THIS page, not of the locale root.
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        "content",
        canonicalHref,
      );

      // Unique title and a description.
      await expect(page).toHaveTitle(/\S/);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        /\S/,
      );
      await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute(
        "content",
        /noindex/,
      );

      // JSON-LD: every block parses; site-wide and page types are present.
      const documents = await page
        .locator('script[type="application/ld+json"]')
        .allTextContents();
      const types = jsonLdTypes(documents);
      for (const type of [...SITE_WIDE_TYPES, ...expectedTypes]) {
        expect(types, `JSON-LD @type ${type}`).toContain(type);
      }

      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("main")).toHaveCount(1);
    });
  }
}

test("titles differ between pages and between locales", async ({ request }) => {
  const titles = new Map<string, string>();
  for (const locale of LOCALES) {
    for (const { pathname } of PAGES) {
      const path = pagePath(locale, pathname);
      const html = await (await request.get(path)).text();
      titles.set(path, /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "");
    }
  }
  expect([...titles.values()].every((title) => title.length > 0)).toBe(true);
  expect(new Set(titles.values()).size).toBe(titles.size);
});

test("the language links keep the current page and switch direction", async ({
  page,
}) => {
  await page.goto("/en/privacy");
  const switcher = page.getByRole("navigation", { name: "Language" });
  await expect(switcher.getByRole("link")).toHaveCount(LOCALES.length);
  await expect(switcher.locator('a[aria-current="true"]')).toHaveAttribute(
    "href",
    "/en/privacy",
  );
  await switcher.locator('a[hreflang="ar"]').click();
  await expect(page).toHaveURL(/\/ar\/privacy$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

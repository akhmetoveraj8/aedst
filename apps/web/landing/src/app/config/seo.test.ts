import { describe, expect, it } from "vitest";
import {
  buildAlternates,
  buildLanguageAlternates,
  buildOpenGraph,
  siteConfig,
} from "@/app/config/seo";
import { locales, toLanguageTag } from "@/shared/i18n/locales";

describe("buildOpenGraph", () => {
  it("points og:url at the page's own canonical, not the locale root", () => {
    const text = { siteName: "S", title: "T", description: "D" };
    const openGraph = buildOpenGraph("privacy", "tj", text);
    expect(openGraph.url).toBe(buildAlternates("privacy", "tj").canonical);
    expect(openGraph.url).toBe("http://localhost:3002/tj/privacy");
    expect(openGraph.locale).toBe("tg");
    expect(openGraph).toMatchObject({ siteName: "S", title: "T" });
  });
});

describe("buildLanguageAlternates", () => {
  it("emits an absolute hreflang URL for every locale plus x-default", () => {
    const alternates = buildLanguageAlternates("privacy");
    for (const locale of locales) {
      expect(alternates[toLanguageTag(locale)]).toBe(
        `http://localhost:3002/${locale}/privacy`,
      );
    }
    expect(alternates["x-default"]).toBe("http://localhost:3002/en/privacy");
  });

  it("uses real BCP 47 tags: Tajik is tg, not the country code tj", () => {
    const alternates = buildLanguageAlternates("");
    expect(alternates.tg).toBe("http://localhost:3002/tj");
    expect(alternates.tj).toBeUndefined();
  });

  it("has no trailing slash on the home page", () => {
    expect(buildLanguageAlternates("").ru).toBe("http://localhost:3002/ru");
  });
});

describe("buildAlternates", () => {
  it("self-references the current locale as canonical", () => {
    const alternates = buildAlternates("terms", "ru");
    expect(alternates.canonical).toBe("http://localhost:3002/ru/terms");
    expect(Object.keys(alternates.languages)).toHaveLength(locales.length + 1);
  });
});

describe("siteConfig", () => {
  it("reads the origin from NEXT_PUBLIC_SITE_URL", () => {
    expect(siteConfig.url.origin).toBe("http://localhost:3002");
  });

  it("is citable by answer engines and closed to training crawlers", () => {
    expect(siteConfig.aiCrawlers).toEqual({
      answerEngines: "allow",
      trainingCrawlers: "deny",
    });
  });
});

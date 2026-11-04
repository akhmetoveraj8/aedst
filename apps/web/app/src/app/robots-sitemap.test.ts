import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { locales } from "@/shared/i18n/locales";

describe("robots.txt", () => {
  it("disallows the API, the offline shell and every signed-in route for all agents", () => {
    const rules = robots().rules;
    const all = (Array.isArray(rules) ? rules : [rules]).find(
      (rule) => rule.userAgent === "*",
    );
    const disallow = ([] as string[]).concat(all?.disallow ?? []);
    expect(disallow).toContain("/api/");
    expect(disallow).toContain("/offline/");
    expect(disallow).toContain("/en/tasks");
    expect(disallow).toContain("/ar/forbidden");
  });

  it("points at the sitemap", () => {
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe("sitemap.xml", () => {
  it("lists every public route once per locale with hreflang alternates", () => {
    const entries = sitemap();
    expect(entries).toHaveLength(locales.length);
    for (const entry of entries) {
      const languages = entry.alternates?.languages ?? {};
      expect(Object.keys(languages).length).toBeGreaterThanOrEqual(
        locales.length,
      );
    }
  });

  it("never lists a signed-in route", () => {
    for (const entry of sitemap()) {
      expect(entry.url).not.toMatch(/\/(tasks|search|notifications)/);
    }
  });
});

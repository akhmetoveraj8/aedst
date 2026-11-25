import { describe, expect, it } from "vitest";
import { publicRoutes } from "@/app/config/public-routes";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { locales } from "@/shared/i18n/locales";
import { answerEngineBots, trainingBots } from "@/shared/lib/seo/ai-crawlers";

function groups() {
  const rules = robots().rules;
  return Array.isArray(rules) ? rules : [rules];
}

function groupOf(bot: string) {
  return groups().find(
    (rule) => Array.isArray(rule.userAgent) && rule.userAgent.includes(bot),
  );
}

describe("robots.txt", () => {
  it("allows all crawlers and points at the sitemap", () => {
    const all = groups().find((rule) => rule.userAgent === "*");
    expect(all?.allow).toBe("/");
    expect(all?.disallow).toBeUndefined();
    expect(robots().sitemap).toBe("http://localhost:3002/sitemap.xml");
  });

  it("allows answer engines and blocks training crawlers", () => {
    expect(groupOf(answerEngineBots[0])?.allow).toBe("/");
    expect(groupOf(trainingBots[0])?.disallow).toBe("/");
  });
});

describe("sitemap.xml", () => {
  it("lists every public route once per locale with hreflang alternates", () => {
    const entries = sitemap();
    expect(entries).toHaveLength(publicRoutes.length * locales.length);
    for (const entry of entries) {
      expect(Object.keys(entry.alternates?.languages ?? {})).toHaveLength(
        locales.length + 1,
      );
    }
  });
});

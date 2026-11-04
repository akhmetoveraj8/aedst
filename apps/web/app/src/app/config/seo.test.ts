import { describe, expect, it } from "vitest";
import { answerEngineBots, trainingBots } from "@/app/config/ai-crawlers";
import {
  buildAlternates,
  buildLanguageAlternates,
  siteConfig,
} from "@/app/config/seo";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { locales, toLanguageTag } from "@/shared/i18n/locales";

describe("buildLanguageAlternates", () => {
  it("emits an absolute hreflang URL for every locale plus x-default", () => {
    const alternates = buildLanguageAlternates("tasks");

    for (const locale of locales) {
      expect(alternates[toLanguageTag(locale)]).toBe(
        `http://localhost:3000/${locale}/tasks`,
      );
    }
    expect(alternates["x-default"]).toBe("http://localhost:3000/en/tasks");
  });

  it("uses real BCP 47 tags: Tajik is tg, not the country code tj", () => {
    const alternates = buildLanguageAlternates("");

    expect(alternates.tg).toBe("http://localhost:3000/tj");
    expect(alternates.tj).toBeUndefined();
  });

  it("handles the root path without a trailing slash", () => {
    expect(buildLanguageAlternates("").ru).toBe("http://localhost:3000/ru");
    expect(buildLanguageAlternates("")["x-default"]).toBe(
      "http://localhost:3000/en",
    );
  });
});

describe("siteConfig", () => {
  it("is neutral template branding with an absolute origin", () => {
    expect(siteConfig.name).toBe("AEDST");
    expect(siteConfig.url.origin).toBe("http://localhost:3000");
    expect(siteConfig.description).not.toMatch(/sign in/i);
  });
});

describe("buildAlternates", () => {
  it("self-references the current locale as canonical and adds hreflang", () => {
    const alternates = buildAlternates("tasks", "ru");

    expect(alternates.canonical).toBe("http://localhost:3000/ru/tasks");
    expect(alternates.languages.en).toBe("http://localhost:3000/en/tasks");
  });

  it("has no trailing slash on the home canonical", () => {
    expect(buildAlternates("", "en").canonical).toBe(
      "http://localhost:3000/en",
    );
  });
});

describe("siteConfig.aiCrawlers", () => {
  it("defaults to citable but not trainable", () => {
    expect(siteConfig.aiCrawlers).toEqual({
      answerEngines: "allow",
      trainingCrawlers: "deny",
    });
  });

  it("names the documented bots in two disjoint lists", () => {
    expect(answerEngineBots).toEqual([
      "OAI-SearchBot",
      "ChatGPT-User",
      "Claude-SearchBot",
      "Claude-User",
      "PerplexityBot",
      "Perplexity-User",
      "Applebot",
    ]);
    expect(trainingBots).toEqual([
      "GPTBot",
      "ClaudeBot",
      "anthropic-ai",
      "CCBot",
      "Google-Extended",
      "Applebot-Extended",
      "Bytespider",
      "Amazonbot",
      "meta-externalagent",
    ]);
    const overlap = answerEngineBots.filter((bot) =>
      (trainingBots as readonly string[]).includes(bot),
    );
    expect(overlap).toEqual([]);
  });
});

describe("robots", () => {
  const rules = () => {
    const { rules } = robots();
    return Array.isArray(rules) ? rules : [rules];
  };
  const forAgent = (agent: string) =>
    rules().find((rule) => [rule.userAgent ?? []].flat().includes(agent));

  it("hides signed-in areas, the BFF proxy and fallbacks from everyone", () => {
    const star = forAgent("*");
    expect(star?.disallow).toEqual(
      expect.arrayContaining([
        "/api/",
        "/offline/",
        "/en/forbidden",
        "/en/tasks",
        "/ar/tasks",
        "/en/search",
        "/en/notifications",
      ]),
    );
    expect(star?.disallow).not.toContain("/en");
  });

  it("lets answer engines in and repeats the private paths for them", () => {
    const rule = forAgent("OAI-SearchBot");
    expect(rule?.allow).toBe("/");
    expect(rule?.disallow).toEqual(forAgent("*")?.disallow);
    expect(forAgent("Claude-User")).toEqual(rule);
  });

  it("blocks training crawlers entirely by default", () => {
    for (const bot of trainingBots) {
      expect(forAgent(bot)?.disallow).toBe("/");
      expect(forAgent(bot)?.allow).toBeUndefined();
    }
  });

  it("points at the sitemap", () => {
    expect(robots().sitemap).toBe("http://localhost:3000/sitemap.xml");
  });
});

describe("sitemap", () => {
  it("publishes a fixed lastModified date, not the request time", () => {
    const entries = sitemap();

    expect(entries.length).toBe(locales.length);
    for (const entry of entries) {
      expect(entry.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(entries[0]?.url).toBe("http://localhost:3000/en");
  });
});

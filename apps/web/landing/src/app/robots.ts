import type { MetadataRoute } from "next";
import {
  answerEngineBots,
  type CrawlerPolicy,
  trainingBots,
} from "@/app/config/ai-crawlers";
import { siteConfig } from "@/app/config/seo";

function groupRules(policy: CrawlerPolicy) {
  // A bot with its own group ignores the `*` group, so each group is complete.
  return policy === "allow" ? { allow: "/" } : { disallow: "/" };
}

export default function robots(): MetadataRoute.Robots {
  const { answerEngines, trainingCrawlers } = siteConfig.aiCrawlers;
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: [...answerEngineBots], ...groupRules(answerEngines) },
      { userAgent: [...trainingBots], ...groupRules(trainingCrawlers) },
    ],
    sitemap: new URL("/sitemap.xml", siteConfig.url).toString(),
  };
}

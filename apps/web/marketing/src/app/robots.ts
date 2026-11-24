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

// Required by `output: "export"`: the file is written once, at build time.
export const dynamic = "force-static";

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

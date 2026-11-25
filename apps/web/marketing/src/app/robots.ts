import type { MetadataRoute } from "next";
import { siteConfig } from "@/app/config/seo";
import {
  answerEngineBots,
  type CrawlerPolicy,
  trainingBots,
} from "@/shared/lib/seo/ai-crawlers";

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

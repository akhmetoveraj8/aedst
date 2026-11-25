import type { MetadataRoute } from "next";
import { privateDisallowPaths } from "@/app/config/private-paths";
import { siteConfig } from "@/app/config/seo";
import {
  answerEngineBots,
  type CrawlerPolicy,
  trainingBots,
} from "@/shared/lib/seo/ai-crawlers";

function groupRules(policy: CrawlerPolicy, disallow: string[]) {
  // A bot with its own group ignores the `*` group, so the private paths are
  // repeated here instead of relying on inheritance.
  return policy === "allow" ? { allow: "/", disallow } : { disallow: "/" };
}

export default function robots(): MetadataRoute.Robots {
  const disallow = privateDisallowPaths();
  const { answerEngines, trainingCrawlers } = siteConfig.aiCrawlers;
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      {
        userAgent: [...answerEngineBots],
        ...groupRules(answerEngines, disallow),
      },
      {
        userAgent: [...trainingBots],
        ...groupRules(trainingCrawlers, disallow),
      },
    ],
    sitemap: new URL("/sitemap.xml", siteConfig.url).toString(),
  };
}

import type { MetadataRoute } from "next";
import { aiCrawlers } from "../lib/ai-crawlers";
import { docsUrl } from "../lib/site";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  const allowTraining = process.env.DOCS_ALLOW_AI_TRAINING === "true";
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: [...aiCrawlers.answer], allow: "/" },
      { userAgent: [...aiCrawlers.training], ...(allowTraining ? { allow: "/" } : { disallow: "/" }) },
    ],
    sitemap: `${docsUrl()}/sitemap.xml`,
  };
}

import { buildLlmsTxt as buildLlmsTxtFor } from "@/shared/lib/seo/llms-txt";
import { publicRoutes } from "./public-routes";
import { siteConfig } from "./seo";

/** Body of this project's /llms.txt (format and links: shared/lib/seo/llms-txt.ts). Documentation has its own llms.txt on the docs site. */
export function buildLlmsTxt(): string {
  return buildLlmsTxtFor({
    site: siteConfig,
    routes: publicRoutes,
    note: "Signed-in areas (tasks, search, notifications) are per-user and not indexable.",
  });
}

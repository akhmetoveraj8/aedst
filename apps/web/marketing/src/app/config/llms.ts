import { buildLlmsTxt as buildLlmsTxtFor } from "@/shared/lib/seo/llms-txt";
import { publicRoutes } from "./public-routes";
import { siteConfig } from "./seo";

/** Body of this project's /llms.txt (format and links: shared/lib/seo/llms-txt.ts). */
export function buildLlmsTxt(): string {
  return buildLlmsTxtFor({
    site: siteConfig,
    routes: publicRoutes,
    note: "This is the public marketing site. The signed-in product lives on a separate origin and is not indexable.",
  });
}

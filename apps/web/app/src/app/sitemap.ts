import type { MetadataRoute } from "next";
import { publicRoutes } from "@/app/config/public-routes";
import { buildLanguageAlternates, siteConfig } from "@/app/config/seo";
import { buildSitemap } from "@/shared/lib/seo/sitemap";

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap({
    routes: publicRoutes,
    siteUrl: siteConfig.url,
    languageAlternates: buildLanguageAlternates,
  });
}

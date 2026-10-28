import type { MetadataRoute } from "next";
import { publicRoutes } from "@/app/config/public-routes";
import { buildLanguageAlternates, siteConfig } from "@/app/config/seo";
import { locales } from "@/shared/i18n/locales";

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.flatMap(
    ({ pathname, changeFrequency, priority, lastModified }) =>
      locales.map((locale) => ({
        url: new URL(
          `/${locale}${pathname ? `/${pathname}` : ""}`,
          siteConfig.url,
        ).toString(),
        lastModified,
        changeFrequency,
        priority,
        alternates: { languages: buildLanguageAlternates(pathname) },
      })),
  );
}

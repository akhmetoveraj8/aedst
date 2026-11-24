import type { MetadataRoute } from "next";
import { publicRoutes } from "@/app/config/public-routes";
import { buildLanguageAlternates, siteConfig } from "@/app/config/seo";
import { locales } from "@/shared/i18n/locales";

// Required by `output: "export"`: the file is written once, at build time.
export const dynamic = "force-static";

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

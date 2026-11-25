import type { MetadataRoute } from "next";

import { locales } from "@/shared/i18n/locales";
import {
  type PublicRoute,
  publicRouteUrl,
} from "@/shared/lib/seo/public-route";

/**
 * A project's sitemap: every public route in every locale, each entry with
 * its hreflang alternates (from that project's `buildLanguageAlternates`).
 */
export function buildSitemap({
  routes,
  siteUrl,
  languageAlternates,
}: {
  routes: readonly PublicRoute[];
  siteUrl: URL;
  languageAlternates: (pathname: string) => Record<string, string>;
}): MetadataRoute.Sitemap {
  return routes.flatMap(
    ({ pathname, changeFrequency, priority, lastModified }) =>
      locales.map((locale) => ({
        url: publicRouteUrl(locale, pathname, siteUrl),
        lastModified,
        changeFrequency,
        priority,
        alternates: { languages: languageAlternates(pathname) },
      })),
  );
}

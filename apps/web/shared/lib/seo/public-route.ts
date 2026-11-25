import type { MetadataRoute } from "next";

/** One indexable page of a project; its `publicRoutes` table feeds the sitemap and llms.txt. */
export type PublicRoute = {
  /**
   * Excludes the locale segment and any leading slash (`""` is the home
   * page), see `buildLanguageAlternates` in each project's config/seo.ts.
   */
  pathname: string;
  /** English label used by llms.txt. */
  label: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
  /**
   * ISO date the page content last changed. Bump it in the same change that
   * edits the page; a made-up "now" on every request makes crawlers distrust
   * the field.
   */
  lastModified: string;
};

/** Absolute URL of a public route in one locale. */
export function publicRouteUrl(
  locale: string,
  pathname: string,
  siteUrl: URL,
): string {
  return new URL(
    `/${locale}${pathname ? `/${pathname}` : ""}`,
    siteUrl,
  ).toString();
}

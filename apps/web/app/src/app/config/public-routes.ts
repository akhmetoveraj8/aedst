import type { MetadataRoute } from "next";

export type PublicRoute = {
  /**
   * Excludes the locale segment and any leading slash (`""` is the home
   * page) - see `buildLanguageAlternates` in config/seo.ts.
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

/**
 * The indexable pages. Consumed by sitemap.ts and llms.txt; the locale
 * fan-out and hreflang alternates are automatic. Session pages are not
 * listed here (they derive from the module manifests, see private-paths.ts).
 */
export const publicRoutes: readonly PublicRoute[] = [
  {
    pathname: "",
    label: "Sign in",
    changeFrequency: "weekly",
    priority: 1,
    lastModified: "2026-10-08",
  },
];

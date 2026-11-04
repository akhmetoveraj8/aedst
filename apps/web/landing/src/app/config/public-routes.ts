import type { MetadataRoute } from "next";

export type PublicRoute = {
  /** Excludes the locale segment and any leading slash (`""` is home). */
  pathname: string;
  /** English label used by llms.txt. */
  label: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
  /**
   * ISO date the page content last changed. Bump it in the same change that
   * edits the page; a made-up "now" makes crawlers distrust the field.
   */
  lastModified: string;
};

/** Every indexable page. Feeds sitemap.ts and llms.txt; locale fan-out is automatic. */
export const publicRoutes: readonly PublicRoute[] = [
  {
    pathname: "",
    label: "Home",
    changeFrequency: "weekly",
    priority: 1,
    lastModified: "2026-10-28",
  },
  {
    pathname: "privacy",
    label: "Privacy policy",
    changeFrequency: "yearly",
    priority: 0.3,
    lastModified: "2026-10-28",
  },
  {
    pathname: "terms",
    label: "Terms of service",
    changeFrequency: "yearly",
    priority: 0.3,
    lastModified: "2026-10-28",
  },
];

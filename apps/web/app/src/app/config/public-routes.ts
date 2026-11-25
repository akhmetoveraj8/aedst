import type { PublicRoute } from "@/shared/lib/seo/public-route";

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

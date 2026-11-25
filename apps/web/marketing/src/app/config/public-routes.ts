import type { PublicRoute } from "@/shared/lib/seo/public-route";

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

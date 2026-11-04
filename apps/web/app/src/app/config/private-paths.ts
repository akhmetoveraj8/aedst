import { locales } from "@/shared/i18n/locales";
import { moduleRoutes } from "./modules/registry";

/**
 * Paths with nothing to index: the BFF proxy, the offline fallback, the
 * forbidden page and every locale-prefixed session route, derived from the
 * module manifests (a new session module is hidden without editing this
 * file). The pages also carry `noindex`; robots.txt saves crawl budget.
 */
export function privateDisallowPaths(): string[] {
  const sessionPaths = moduleRoutes
    .filter((route) => route.access === "session")
    .flatMap((route) => locales.map((locale) => `/${locale}${route.path}`));
  return [
    "/api/",
    "/offline/",
    ...locales.map((locale) => `/${locale}/forbidden`),
    ...sessionPaths,
  ];
}

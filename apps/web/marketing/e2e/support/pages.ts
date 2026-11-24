/**
 * Every public page of the marketing, per locale. Kept as literals on purpose:
 * the specs must fail when `config/public-routes.ts` or the locale list
 * changes without the rendered HTML being re-checked.
 */
export const LOCALES = ["en", "ru", "tj", "uz", "ar"] as const;

/** URL locale -> BCP 47 tag used in `hreflang` and `<html lang>` (`tj` is Tajik, `tg`). */
export const LANGUAGE_TAGS: Record<(typeof LOCALES)[number], string> = {
  en: "en",
  ru: "ru",
  tj: "tg",
  uz: "uz",
  ar: "ar",
};

export const SITE_WIDE_TYPES = ["Organization", "WebSite"];

export const PAGES = [
  { pathname: "", jsonLdTypes: ["SoftwareApplication", "FAQPage"] },
  { pathname: "privacy", jsonLdTypes: ["BreadcrumbList"] },
  { pathname: "terms", jsonLdTypes: ["BreadcrumbList"] },
] as const;

export function pagePath(locale: string, pathname: string): string {
  return pathname ? `/${locale}/${pathname}` : `/${locale}`;
}

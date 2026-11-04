import { defineRouting } from "next-intl/routing";

import { defaultLocale, locales } from "@/shared/i18n/locales";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
  localeDetection: true,
  // hreflang is emitted by page metadata with real BCP 47 tags (see
  // `toLanguageTag`); next-intl's own `Link` header would repeat it with the
  // app's internal codes (`tj`), which crawlers reject.
  alternateLinks: false,
});

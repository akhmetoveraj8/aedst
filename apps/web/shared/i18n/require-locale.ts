import { notFound } from "next/navigation";

import { type Locale, locales } from "@/shared/i18n/locales";

/**
 * Narrows the `[locale]` route param (a plain `string` in Next's generated
 * `PageProps`) to `Locale`, or renders the 404 page. next-intl's server
 * helpers are typed with the app's `Locale` (see `messages.d.ts`).
 */
export function requireLocale(value: string): Locale {
  const match = locales.find((locale) => locale === value);
  if (!match) {
    notFound();
  }
  return match;
}

export const locales = ["en", "ru", "tj", "uz", "ar"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
  tj: "Тоҷикӣ",
  uz: "O'zbekcha",
  ar: "العربية",
};

/**
 * The app's locale codes are shared across all five platforms, and `tj` is
 * Tajikistan's *country* code — the language's BCP 47 tag is `tg`. Anything a
 * browser or crawler reads (`<html lang>`, hreflang, og:locale, JSON-LD) must
 * use the real tag, or Lighthouse flags an invalid hreflang and screen readers
 * pick the wrong voice.
 */
const LANGUAGE_TAGS: Record<Locale, string> = {
  en: "en",
  ru: "ru",
  tj: "tg",
  uz: "uz",
  ar: "ar",
};

export function toLanguageTag(locale: Locale): string {
  return LANGUAGE_TAGS[locale];
}

export const rtlLocales: readonly Locale[] = ["ar"];

export function getLocaleDirection(locale: Locale): "ltr" | "rtl" {
  return rtlLocales.includes(locale) ? "rtl" : "ltr";
}

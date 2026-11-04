import { pickFallbackLocale } from "@/app/config/i18n/fallback-messages";
import { type Locale, locales } from "@/shared/i18n/locales";

const LOCALE_PATH = new RegExp(`^/(${locales.join("|")})(/.*)?$`);

/** `/ru/admin/tasks` -> `{ locale: "ru", rest: "/admin/tasks" }`; `null` without a known locale prefix. */
export function splitLocale(
  pathname: string,
): { locale: Locale; rest: string } | null {
  const match = LOCALE_PATH.exec(pathname);
  if (!match) {
    return null;
  }
  return { locale: match[1] as Locale, rest: match[2] ?? "" };
}

/** The visitor's preferred supported locale (browser languages), else the default. */
export function negotiateLocale(): Locale {
  return pickFallbackLocale({ languages: navigator.languages });
}

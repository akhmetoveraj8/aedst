import { format, formatDistanceToNow, parse } from "date-fns";
import { ar, enUS, ru, uz } from "date-fns/locale";

import type { Locale } from "@/shared/i18n/locales";

type DateFnsLocale = typeof enUS;

// AEDST Library-First rule: date-fns is the one primary date tool for
// this app — no toLocaleDateString()/toLocaleString(), no second date
// library. THIS FILE IS THE ONLY SEAM to date-fns (Biome noRestrictedImports
// enforces it), so a later move to Temporal (docs/content/decisions.md,
// "Temporal instead of date-fns", Pending) touches one file. date-fns has no Tajik locale, so "tj" falls back to "ru" (closest
// shared date/number conventions of the app's supported locales) rather than
// silently defaulting to English formatting.
const DATE_FNS_LOCALES: Record<Locale, DateFnsLocale> = {
  en: enUS,
  ru,
  tj: ru,
  uz,
  ar,
};

export function formatDate(date: Date, locale: Locale): string {
  return format(date, "PP", { locale: DATE_FNS_LOCALES[locale] });
}

export function formatDateTime(date: Date, locale: Locale): string {
  return format(date, "PPp", { locale: DATE_FNS_LOCALES[locale] });
}

/** `yyyy-MM-dd` in the local time zone: the value of an `<input type="date">`. */
export function formatDateInputValue(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Local midnight of a `yyyy-MM-dd` string (an `<input type="date">` value): the
 * inverse of formatDateInputValue, so the day the user picked is the day
 * formatDate shows back in any time zone (UTC parsing shifted it one day in
 * zones west of UTC). The one sanctioned way to build a Date from a string:
 * `new Date(text)` is banned (Biome plugin lint/no-date-from-string.grit).
 */
export function parseDateInputValue(value: string): Date {
  return parse(value, "yyyy-MM-dd", new Date());
}

/** "5 minutes ago", localized (inbox, audit log). */
export function formatRelative(date: Date, locale: Locale): string {
  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: DATE_FNS_LOCALES[locale],
  });
}

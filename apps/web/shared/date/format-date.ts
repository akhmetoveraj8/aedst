import { format, formatDistanceToNow, parse } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { use } from "react";

import type { Locale } from "@/shared/i18n/locales";

type DateFnsLocale = typeof enUS;

// AEDST Library-First rule: date-fns is the one primary date tool for
// this app — no toLocaleDateString()/toLocaleString(), no second date
// library. THIS FILE IS THE ONLY SEAM to date-fns (Biome noRestrictedImports
// enforces it), so a later move to Temporal (docs/content/decisions.md,
// "Temporal instead of date-fns", Pending) touches one file.
//
// Locale data is loaded on demand: only English (date-fns's own default, so
// already in the bundle) is static; the active non-English locale is one
// small chunk fetched the first time it is needed instead of all four in
// every route. date-fns has no Tajik locale, so "tj" uses "ru" (closest
// shared date/number conventions of the app's supported locales) rather than
// silently defaulting to English formatting.
const LOADERS: Record<Exclude<Locale, "en">, () => Promise<DateFnsLocale>> = {
  ru: async () => (await import("date-fns/locale/ru")).ru,
  tj: async () => (await import("date-fns/locale/ru")).ru,
  uz: async () => (await import("date-fns/locale/uz")).uz,
  ar: async () => (await import("date-fns/locale/ar")).ar,
};

const loaded = new Map<Locale, DateFnsLocale>([["en", enUS]]);
const pending = new Map<Locale, Promise<void>>();

/**
 * Loads the date-fns data of `locale` once (idempotent, shared promise).
 * A failed chunk load resolves anyway and leaves English in place for this
 * page load: a date in the wrong language beats a broken page, and a
 * component suspended on it must not retry forever.
 */
export function loadDateLocale(locale: Locale): Promise<void> {
  if (loaded.has(locale)) {
    return Promise.resolve();
  }
  let promise = pending.get(locale);
  if (!promise) {
    promise = LOADERS[locale as Exclude<Locale, "en">]()
      .catch(() => enUS)
      .then((data) => {
        loaded.set(locale, data);
        pending.delete(locale);
      });
    pending.set(locale, promise);
  }
  return promise;
}

/**
 * Call once in a component that formats dates, before formatting: it
 * suspends (React `use`) until the locale data is there, on the server and
 * during hydration alike, so the sync formatters below never render English
 * text for another locale or mismatch the server HTML. Free once loaded.
 */
export function useDateLocale(locale: Locale): void {
  if (!loaded.has(locale)) {
    use(loadDateLocale(locale));
  }
}

/** The loaded data of `locale`, or English until it has loaded. */
function dateLocale(locale: Locale): DateFnsLocale {
  return loaded.get(locale) ?? enUS;
}

export function formatDate(date: Date, locale: Locale): string {
  return format(date, "PP", { locale: dateLocale(locale) });
}

export function formatDateTime(date: Date, locale: Locale): string {
  return format(date, "PPp", { locale: dateLocale(locale) });
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
    locale: dateLocale(locale),
  });
}

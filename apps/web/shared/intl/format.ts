import { type Locale, toLanguageTag } from "@/shared/i18n/locales";

// THE ONLY PLACE `new Intl.*` may appear (Biome plugin lint/no-intl-constructors.grit).
// Every formatter is keyed by the real BCP 47 tag from `toLanguageTag` (the
// app's internal Tajik code `tj` is not a valid tag: Intl needs `tg`) and is
// cached, because constructing an Intl object is the expensive part.
// Dates stay in `@/shared/date/format-date` (date-fns).

const numberFormats = new Map<string, Intl.NumberFormat>();
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

function numberFormat(
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const tag = toLanguageTag(locale);
  const key = `${tag}|${JSON.stringify(options ?? {})}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(tag, options);
    numberFormats.set(key, format);
  }
  return format;
}

/** `1,234` / `1 234` / `١٬٢٣٤`: the locale's digits and grouping. */
export function formatNumber(value: number | bigint, locale: Locale): string {
  return numberFormat(locale).format(value);
}

/** Compact byte count: `1.5 MB` style, narrow unit, locale digits. */
export function formatBytes(bytes: number | bigint, locale: Locale): string {
  return numberFormat(locale, {
    notation: "compact",
    style: "unit",
    unit: "byte",
    unitDisplay: "narrow",
  }).format(bytes);
}

/** `in 3 days` / `yesterday`: the phrase for an offset in one unit. */
export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  locale: Locale,
): string {
  const tag = toLanguageTag(locale);
  let format = relativeFormats.get(tag);
  if (!format) {
    format = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
    relativeFormats.set(tag, format);
  }
  return format.format(value, unit);
}

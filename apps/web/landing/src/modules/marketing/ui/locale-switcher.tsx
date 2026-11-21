"use client";

import { usePathname } from "next/navigation";
import {
  type Locale,
  localeNames,
  locales,
  toLanguageTag,
} from "@/shared/i18n/locales";

/**
 * Language picker as plain links. A client island only because the current
 * path is not known to a statically rendered layout: `usePathname` is part of
 * the Next.js runtime, so this adds no library (the base-ui select and the
 * next-intl client runtime it replaced were about 60 KB of first load). A
 * language change is a full navigation on purpose: `<html lang dir>` changes.
 */
export function LocaleSwitcher({
  label,
  current,
}: {
  label: string;
  current: Locale;
}) {
  const pathname = usePathname();
  // `/en/privacy` -> `/privacy`; the locale prefix is always present.
  const rest = pathname.replace(/^\/[^/]+/, "");

  return (
    <nav aria-label={label}>
      <ul className="flex items-center gap-0.5 text-sm">
        {locales.map((locale) => (
          <li key={locale}>
            <a
              href={`/${locale}${rest}`}
              hrefLang={toLanguageTag(locale)}
              lang={toLanguageTag(locale)}
              aria-current={locale === current ? "true" : undefined}
              className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-md px-1.5 py-1 text-muted-foreground uppercase hover:text-foreground aria-[current=true]:font-medium aria-[current=true]:text-foreground"
            >
              <span>{toLanguageTag(locale)}</span>
              <span className="sr-only"> {localeNames[locale]}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

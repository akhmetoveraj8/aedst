import { type AbstractIntlMessages, hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import type { Locale } from "@/shared/i18n/locales";
import { routing } from "@/shared/i18n/routing";

/**
 * next-intl's per-request config for a Next.js project: the requested locale
 * when it is supported, else the default, with that project's catalogues.
 * Each project's `src/app/config/i18n/request.ts` (the path its
 * next.config.ts hands to the next-intl plugin) default-exports the result.
 */
export function createRequestConfig(
  loadMessages: (locale: Locale) => Promise<AbstractIntlMessages>,
) {
  return getRequestConfig(async ({ requestLocale }) => {
    const requested = await requestLocale;
    const locale = hasLocale(routing.locales, requested)
      ? requested
      : routing.defaultLocale;

    return {
      locale,
      messages: await loadMessages(locale),
    };
  });
}

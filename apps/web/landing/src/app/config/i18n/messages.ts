import type { Locale } from "@/shared/i18n/locales";

/**
 * Request-scoped `messages` for a locale: `common` (nav, footer, errors) plus
 * one namespace per module in `src/modules/<module>/i18n/<locale>.json`.
 * Read server-side only; client components get their few strings as props, so
 * no catalog is ever serialized into the page.
 *
 * One literal import path per module (not `${module}` in the path): Turbopack
 * resolves each of them statically at build time.
 */
const moduleCatalogs = {
  marketing: (locale: Locale) =>
    import(`@/modules/marketing/i18n/${locale}.json`),
  legal: (locale: Locale) => import(`@/modules/legal/i18n/${locale}.json`),
} as const;

const i18nModules = Object.keys(
  moduleCatalogs,
) as (keyof typeof moduleCatalogs)[];

export async function loadMessages(locale: Locale) {
  const [common, ...entries] = await Promise.all([
    import(`@/app/config/i18n/common/${locale}.json`).then((m) => m.default),
    ...i18nModules.map(async (module) => {
      const messages = await moduleCatalogs[module](locale);
      return [module, messages.default] as const;
    }),
  ]);
  return { common, ...Object.fromEntries(entries) };
}

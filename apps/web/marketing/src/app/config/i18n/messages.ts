import {
  type I18nNamespace,
  i18nNamespaces,
} from "@/app/config/modules/registry";
import { type Locale, sharedLocale } from "@/shared/i18n/locales";

/**
 * Request-scoped `messages` for a locale: `common` (nav, footer, errors) plus
 * one namespace per module, from `apps/web/shared/i18n/catalogs/<module>/<locale>.json` (alias `@i18n`, generated from `packages/i18n`).
 * Read server-side only; client components get their few strings as props, so
 * no catalog is ever serialized into the page.
 *
 * One literal import path per module (not `${module}` in the path): Turbopack
 * resolves each of them statically at build time. The module list itself comes
 * from the registry: a registered module without a loader here fails `tsc`.
 */
const moduleCatalogs = {
  marketing: (locale: Locale) =>
    import(`@i18n/marketing/${sharedLocale(locale)}.json`),
  legal: (locale: Locale) => import(`@i18n/legal/${sharedLocale(locale)}.json`),
} satisfies Record<I18nNamespace, (locale: Locale) => Promise<unknown>>;

export async function loadMessages(locale: Locale) {
  const [common, ...entries] = await Promise.all([
    import(`@i18n/marketing-common/${sharedLocale(locale)}.json`).then(
      (m) => m.default,
    ),
    ...i18nNamespaces.map(async (module) => {
      const messages = await moduleCatalogs[module](locale);
      return [module, messages.default] as const;
    }),
  ]);
  return { common, ...Object.fromEntries(entries) };
}

import { i18nModules } from "@/app/config/i18n/modules";
import { type Locale, sharedLocale } from "@/shared/i18n/locales";

/**
 * Assembles the request-scoped `messages` object for a locale by merging:
 * - `common`: cross-cutting strings shared by every module (nav, actions, errors)
 * - one namespace per feature module, loaded from `apps/web/shared/i18n/catalogs/<module>/<locale>.json` (alias `@i18n`), generated from `packages/i18n`
 *
 * This keeps translations co-located with the module that owns them instead
 * of a single growing `messages/<locale>.json` file.
 *
 * `namespaces` limits the module catalogs (`common` is always included). The
 * request config loads everything for server components (`getTranslations`
 * reads it server-side and it never reaches the browser); what is *sent* to
 * client components is a subset per route, see `providers/route-messages.tsx`.
 */
export async function loadMessages(
  locale: Locale,
  namespaces: readonly string[] = i18nModules,
) {
  const requested = new Set(namespaces);
  const wanted = i18nModules.filter((module) => requested.has(module));
  const [common, ...moduleEntries] = await Promise.all([
    import(`@i18n/common/${sharedLocale(locale)}.json`).then((m) => m.default),
    ...wanted.map(async (module) => {
      const messages = await import(
        `@i18n/${module}/${sharedLocale(locale)}.json`
      );
      return [module, messages.default] as const;
    }),
  ]);

  return {
    common,
    ...Object.fromEntries(moduleEntries),
  };
}

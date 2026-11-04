import { i18nModules } from "@/app/config/i18n/modules";
import type { Locale } from "@/shared/i18n/locales";

/**
 * Assembles the request-scoped `messages` object for a locale by merging:
 * - `common`: cross-cutting strings shared by every module (nav, actions, errors)
 * - one namespace per feature module, loaded from `src/modules/<module>/i18n/<locale>.json`
 *
 * This keeps translations co-located with the module that owns them instead
 * of a single growing `messages/<locale>.json` file.
 *
 * `namespaces` limits the module catalogs (`common` is always included). The
 * request config loads everything for server components (`getTranslations`
 * reads it server-side and it never reaches the browser); what is *sent* to
 * client components is a subset per route, see `providers/RouteMessages.tsx`.
 */
export async function loadMessages(
  locale: Locale,
  namespaces: readonly string[] = i18nModules,
) {
  const wanted = i18nModules.filter((module) => namespaces.includes(module));
  const [common, ...moduleEntries] = await Promise.all([
    import(`@/app/config/i18n/common/${locale}.json`).then((m) => m.default),
    ...wanted.map(async (module) => {
      const messages = await import(`@/modules/${module}/i18n/${locale}.json`);
      return [module, messages.default] as const;
    }),
  ]);

  return {
    common,
    ...Object.fromEntries(moduleEntries),
  };
}

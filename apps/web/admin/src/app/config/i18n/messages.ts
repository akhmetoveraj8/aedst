import { i18nModules } from "@/app/config/i18n/modules";
import { type Locale, sharedLocale } from "@/shared/i18n/locales";

type JsonModule = { default: Record<string, unknown> };

// One lazy chunk per catalogue file: only the active locale is ever fetched.
// Module catalogues are generated from packages/i18n into apps/web/shared (see its README).
const SHARED_CATALOGUES = "../../../../../shared/i18n/catalogs";
const moduleCatalogues = import.meta.glob<JsonModule>(
  "../../../../../shared/i18n/catalogs/*/*.json",
);

async function load(
  catalogues: Record<string, () => Promise<JsonModule>>,
  path: string,
) {
  const importer = catalogues[path];
  if (!importer) {
    throw new Error(`Missing message catalogue: ${path}`);
  }
  return (await importer()).default;
}

/**
 * Assembles the `messages` object for a locale by merging:
 * - `common`: cross-cutting strings shared by every module (nav, actions, errors)
 * - one namespace per feature module, from `shared/i18n/catalogs/<module>/<locale>.json` (generated from `packages/i18n`)
 *
 * This keeps translations co-located with the module that owns them instead
 * of a single growing `messages/<locale>.json` file. `namespaces` limits the
 * module catalogues (`common` is always included).
 */
export async function loadMessages(
  locale: Locale,
  namespaces: readonly string[] = i18nModules,
) {
  const requested = new Set(namespaces);
  const wanted = i18nModules.filter((module) => requested.has(module));
  const [common, ...moduleEntries] = await Promise.all([
    load(
      moduleCatalogues,
      `${SHARED_CATALOGUES}/admin-common/${sharedLocale(locale)}.json`,
    ),
    ...wanted.map(
      async (module) =>
        [
          module,
          await load(
            moduleCatalogues,
            `${SHARED_CATALOGUES}/${module}/${sharedLocale(locale)}.json`,
          ),
        ] as const,
    ),
  ]);

  return { common, ...Object.fromEntries(moduleEntries) };
}

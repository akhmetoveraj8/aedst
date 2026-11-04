import { i18nModules } from "@/app/config/i18n/modules";
import type { Locale } from "@/shared/i18n/locales";

type JsonModule = { default: Record<string, unknown> };

// One lazy chunk per catalogue file: only the active locale is ever fetched.
const commonCatalogues = import.meta.glob<JsonModule>(
  "/src/app/config/i18n/common/*.json",
);
const moduleCatalogues = import.meta.glob<JsonModule>(
  "/src/modules/*/i18n/*.json",
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
 * - one namespace per feature module, from `src/modules/<module>/i18n/<locale>.json`
 *
 * This keeps translations co-located with the module that owns them instead
 * of a single growing `messages/<locale>.json` file. `namespaces` limits the
 * module catalogues (`common` is always included).
 */
export async function loadMessages(
  locale: Locale,
  namespaces: readonly string[] = i18nModules,
) {
  const wanted = i18nModules.filter((module) => namespaces.includes(module));
  const [common, ...moduleEntries] = await Promise.all([
    load(commonCatalogues, `/src/app/config/i18n/common/${locale}.json`),
    ...wanted.map(
      async (module) =>
        [
          module,
          await load(
            moduleCatalogues,
            `/src/modules/${module}/i18n/${locale}.json`,
          ),
        ] as const,
    ),
  ]);

  return { common, ...Object.fromEntries(moduleEntries) };
}

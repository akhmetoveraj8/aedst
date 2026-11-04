import { manifest as admin } from "@/modules/admin/manifest";
import type { ModuleManifest } from "@/shared/modules/manifest";

/**
 * The single registry of the admin project's feature modules. Adding a module
 * = create its `manifest.ts` and list it here; the i18n loader derives from
 * this list. Manifests are UI-free, so importing this from `proxy.ts` is cheap.
 */
const manifests: readonly ModuleManifest[] = [admin];

/** Message namespaces to load, one catalogue per entry (`modules/<ns>/i18n`). */
export const i18nNamespaces: readonly string[] = manifests.flatMap(
  (module) => module.i18nNamespaces,
);

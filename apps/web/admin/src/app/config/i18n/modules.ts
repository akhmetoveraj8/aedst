import { i18nNamespaces } from "@/app/config/modules/registry";

/**
 * Feature modules that ship their own translation catalogs
 * (`src/modules/<module>/i18n/<locale>.json`), derived from the module
 * manifests via the registry. The type-level mirror is `messages.d.ts`.
 */
export const i18nModules = i18nNamespaces;

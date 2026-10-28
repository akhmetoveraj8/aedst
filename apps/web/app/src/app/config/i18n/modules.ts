import { i18nNamespaces } from "@/app/config/modules/registry";

/**
 * Feature modules that ship their own translation catalogs
 * (`src/modules/<module>/i18n/<locale>.json`), derived from the module
 * manifests (`manifest.i18nNamespaces`) via the registry: adding a module's
 * manifest there is the only wiring needed to get it merged into the
 * request-scoped `messages` object under its own namespace — see `messages.ts`.
 * The type-level mirror is `messages.d.ts`.
 */
export const i18nModules = i18nNamespaces;

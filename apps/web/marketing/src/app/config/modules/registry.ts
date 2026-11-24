import { manifest as legal } from "@/modules/legal/manifest";
import { manifest as marketing } from "@/modules/marketing/manifest";

/**
 * The single registry of the marketing project's modules. Adding a module =
 * create its `manifest.ts` and `public.ts`, list it here and add its
 * catalogue loader in `src/app/config/i18n/messages.ts` (the type there fails
 * until you do). Manifests are UI-free data.
 */
const manifests = [marketing, legal] as const;

/** Message namespaces to load, one catalogue per entry (`modules/<ns>/i18n`). */
export const i18nNamespaces = manifests.flatMap(
  (module) => module.i18nNamespaces,
);

export type I18nNamespace = (typeof i18nNamespaces)[number];

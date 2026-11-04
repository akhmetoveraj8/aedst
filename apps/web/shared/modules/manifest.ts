/**
 * The contract every feature module (`src/modules/<id>/manifest.ts`) fulfils.
 *
 * A manifest is plain, UI-free data: it is read by `proxy.ts` (route guard),
 * the app shell (navigation) and the i18n loader through the single registry
 * in `src/app/config/modules/registry.ts`, so nothing outside a module
 * hard-codes what the module owns. Because it is data, it can later be
 * served by a different deployable (see docs/content/web/microfrontends.md).
 *
 * Rules, enforced by `scripts/check-feature-boundaries.sh`:
 * - `manifest.ts` imports only from `@/shared/**` (no React, no module code);
 * - every `useFeatureFlag("x")` in a module is listed in its `featureFlags`;
 * - code outside the module reaches it only through `manifest.ts`, `public.ts`
 *   and (for offline-outbox handlers) `outbox.ts`.
 */

export type ModuleRoute = {
  /** Locale-less path prefix, e.g. `/tasks`; it matches itself and sub-paths. */
  path: string;
  /** `session` pages are redirected to sign-in when anonymous (proxy.ts). */
  access: "public" | "session";
  /** Role the signed-in user must hold (UX gate; the server enforces it). */
  requiredRole?: string;
};

export type ModuleNavEntry = {
  href: string;
  /** Key under `common.nav` in the app-shell catalogue. */
  labelKey: string;
  /** Ascending sort order in the primary navigation. */
  order: number;
  requiredRole?: string;
};

export type ModuleManifest = {
  /** Folder name under `src/modules`; unique. */
  id: string;
  /** Top-level message namespaces, loaded from `src/modules/<id>/i18n/<locale>.json`. */
  i18nNamespaces: readonly string[];
  routes: readonly ModuleRoute[];
  nav: readonly ModuleNavEntry[];
  /**
   * Capability negotiation (docs/contract/behavior/capabilities.json): the
   * module is a server feature named by its `id`. Built-in (the default) means
   * on until the server says otherwise; `flagged` means off until the server
   * enables it. A disabled module's nav entries are hidden and its session
   * routes are denied by the route guard.
   */
  flagged?: boolean;
  /** Feature flags the module reads (inventory for kill-switches and ownership). */
  featureFlags: readonly string[];
  /** Browser/runtime capabilities the module needs, e.g. `push`, `camera`. */
  capabilities: readonly string[];
  /** Roles the module's pages or actions are gated on. */
  permissions: readonly string[];
  /**
   * Offline-outbox item types the module delivers (e.g. `task.create`). The
   * matching `OutboxHandler`s are exported from the module's client-safe `outbox.ts`
   * and loaded lazily by `src/app/config/modules/outbox-handlers.ts`; a test
   * keeps the two lists equal.
   */
  outbox?: readonly string[];
};

export function defineModule<const T extends ModuleManifest>(manifest: T): T {
  return manifest;
}

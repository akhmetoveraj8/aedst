import { manifest as auth } from "@/modules/auth/manifest";
import { manifest as media } from "@/modules/media/manifest";
import { manifest as notifications } from "@/modules/notifications/manifest";
import { manifest as search } from "@/modules/search/manifest";
import { manifest as tasks } from "@/modules/tasks/manifest";
import { CLIENT_VERSION } from "@/shared/api/connect/client-id";
import {
  type CapabilitySnapshot,
  isFeatureShown,
} from "@/shared/lib/capabilities/evaluate";
import type {
  ModuleManifest,
  ModuleNavEntry,
  ModuleRoute,
} from "@/shared/modules/manifest";

/**
 * The single registry of feature modules. Adding a module = create its
 * `manifest.ts` and list it here; the route guard, primary navigation and
 * i18n loader all derive from this list (nothing else hard-codes a module).
 * Manifests are UI-free, so importing this from `proxy.ts` is cheap.
 */
export const manifests: readonly ModuleManifest[] = [
  auth,
  tasks,
  search,
  notifications,
  media,
];

export const moduleRoutes: readonly ModuleRoute[] = manifests.flatMap(
  (module) => module.routes,
);

/** Message namespaces to load, one catalogue per entry (`modules/<ns>/i18n`). */
export const i18nNamespaces: readonly string[] = manifests.flatMap(
  (module) => module.i18nNamespaces,
);

/** Built AND server-enabled (capability negotiation); see shared/lib/capabilities. */
function isModuleShown(
  module: ModuleManifest,
  snapshot: CapabilitySnapshot | null,
): boolean {
  return isFeatureShown(
    { name: module.id, flagged: module.flagged ?? false },
    snapshot,
    CLIENT_VERSION,
  );
}

/** Path prefixes of session routes whose module the server has switched off. */
export function disabledRoutePrefixes(
  snapshot: CapabilitySnapshot | null,
): string[] {
  return manifests
    .filter((module) => !isModuleShown(module, snapshot))
    .flatMap((module) =>
      module.routes
        .filter((route) => route.access === "session")
        .map((route) => route.path),
    );
}

/** Primary navigation for a user holding `roles`, in manifest `order`. */
export function navEntriesFor(
  hasRole: (role: string) => boolean,
  snapshot: CapabilitySnapshot | null = null,
): ModuleNavEntry[] {
  return manifests
    .filter((module) => isModuleShown(module, snapshot))
    .flatMap((module) => module.nav)
    .filter((entry) => !entry.requiredRole || hasRole(entry.requiredRole))
    .sort((a, b) => a.order - b.order);
}

/**
 * Message namespaces of the modules that own the given route paths (the
 * longest matching `manifest.routes` prefix wins), for sending only those
 * catalogs to the browser. Unknown paths contribute nothing.
 */
export function i18nNamespacesForRoutes(paths: readonly string[]): string[] {
  const namespaces = new Set<string>();
  for (const path of paths) {
    let best: { module: ModuleManifest; length: number } | null = null;
    for (const module of manifests) {
      for (const route of module.routes) {
        const matches =
          path === route.path ||
          (route.path !== "/" && path.startsWith(`${route.path}/`));
        if (matches && (!best || route.path.length > best.length)) {
          best = { module, length: route.path.length };
        }
      }
    }
    for (const namespace of best?.module.i18nNamespaces ?? []) {
      namespaces.add(namespace);
    }
  }
  return [...namespaces];
}

/** Namespaces of modules with a public route (the sign-in marketing): shipped with every page. */
export const publicI18nNamespaces: readonly string[] = manifests
  .filter((module) => module.routes.some((route) => route.access === "public"))
  .flatMap((module) => module.i18nNamespaces);

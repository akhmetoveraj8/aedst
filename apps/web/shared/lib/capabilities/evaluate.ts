/**
 * Capability negotiation rules (docs/contract/behavior/capabilities.json),
 * as pure functions so the route guard (server), the navigation (client) and
 * the contract replay test all share one implementation.
 *
 * - A feature is shown only if this build includes it AND the server enables it.
 * - Server features this build does not know are ignored (they are never asked
 *   about, so they can never crash anything).
 * - Without any snapshot, built-in features are on and flagged ones are off.
 * - A snapshot that lists a feature decides it; one that does not list a
 *   built-in leaves it on, a flagged one stays off. The server lists one
 *   coarse entry per module id (ADR-0009); `enabled: false` always wins.
 * - The typed `required_client_version` hides the feature on older clients.
 */

type FeatureState = {
  enabled: boolean;
  /** Oldest client release that may show the feature (semver). */
  requiredClientVersion?: string;
};

/** JSON-safe, so it can be cached in localStorage and shipped to the client. */
export type CapabilitySnapshot = {
  features: Readonly<Record<string, FeatureState>>;
  /** The caller's standing: "current", "recommended" or "unspecified". */
  updateStatus: "unspecified" | "current" | "recommended";
  /** Support window of this platform ("web"), empty when not configured. */
  minimum: string;
  recommended: string;
  fetchedAt: number;
};

export type FeatureDeclaration = {
  /** Server feature name; built-in features are the module ids. */
  name: string;
  /** Off until the server explicitly enables it. */
  flagged: boolean;
};

/** Dotted-numeric semver comparison (`1.10.0` > `1.9.0`); build metadata is ignored. */
function compareVersions(a: string, b: string): number {
  const core = (v: string) => v.split(/[-+]/, 1)[0] ?? "";
  return core(a).localeCompare(core(b), "en", { numeric: true });
}

export function isFeatureShown(
  feature: FeatureDeclaration,
  snapshot: CapabilitySnapshot | null,
  clientVersion: string,
): boolean {
  const listed = snapshot?.features[feature.name];
  if (!listed) {
    return !feature.flagged;
  }
  if (!listed.enabled) {
    return false;
  }
  return (
    !listed.requiredClientVersion ||
    compareVersions(clientVersion, listed.requiredClientVersion) >= 0
  );
}

/** Fetch failure -> last known -> (null, meaning the defaults above). */
export function chooseSnapshot(
  fetched: CapabilitySnapshot | null | undefined,
  lastKnown: CapabilitySnapshot | null | undefined,
): CapabilitySnapshot | null {
  return fetched ?? lastKnown ?? null;
}

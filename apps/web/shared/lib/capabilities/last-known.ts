import type { CapabilitySnapshot } from "@/shared/lib/capabilities/evaluate";
import { parseSnapshot } from "@/shared/lib/capabilities/snapshot";

const KEY = "aedst:capabilities:v1";

/**
 * The last snapshot this browser received, so a failed fetch (offline, server
 * down) keeps the screens it last knew instead of reverting to the defaults.
 * localStorage can be absent, full or blocked; every access is guarded and a
 * failure just means "nothing known".
 */
export function readLastKnown(): CapabilitySnapshot | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? parseSnapshot(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeLastKnown(snapshot: CapabilitySnapshot): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Storage unavailable: negotiation still works for this page load.
  }
}

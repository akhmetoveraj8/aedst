"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * `navigator.onLine` as React state (platform API, no dependency). `true`
 * during SSR so the server never renders an offline banner. Next's own
 * `useOffline` is still experimental (`experimental.useOffline`), so it is
 * not used yet.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

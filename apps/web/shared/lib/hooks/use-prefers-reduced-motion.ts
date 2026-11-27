"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * `prefers-reduced-motion: reduce` as React state, for motion that CSS cannot
 * reach (script-driven scrolling and carousels). `false` during SSR. CSS
 * animations are handled by `shared/ui/a11y.css` and `motion-reduce:`.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

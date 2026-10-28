"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";

/**
 * Calls `onVisible` whenever the returned element scrolls into (or near) view:
 * the "load the next page" sentinel at the end of an infinite or virtualized
 * list. Attach the returned callback ref to an empty element after the list.
 *
 * Native `IntersectionObserver` (react-use is not installed in this app, and
 * nothing else on the approved stack provides one). While `enabled` is false
 * (no next page, or one is already loading) nothing is observed; when it turns
 * true again the observer is recreated, which re-delivers the initial state, so
 * a sentinel that is still visible after a page lands loads the next one.
 */
export function useSentinel(
  onVisible: () => void,
  { enabled, rootMargin = "200px" }: { enabled: boolean; rootMargin?: string },
) {
  const [node, setNode] = useState<Element | null>(null);
  const notify = useEffectEvent(onVisible);
  const ref = useCallback((element: Element | null) => setNode(element), []);

  useEffect(() => {
    if (!(enabled && node) || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          notify();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, node, rootMargin]);

  return ref;
}

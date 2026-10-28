"use client";

import { useEffect, useState } from "react";

/**
 * Trails `value` by `delayMs`, restarting the timer on every change.
 *
 * Why this exists instead of nuqs' own `debounce`: nuqs only delays the URL
 * *write*; the state it returns updates immediately, so a query keyed on it
 * would still fire per keystroke. This delays the value that feeds the
 * request (documented exception in docs/content/library-first.md).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

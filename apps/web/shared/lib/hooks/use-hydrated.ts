"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * `false` on the server and during the hydration pass, `true` afterwards.
 *
 * Forms use it to stay disabled until React has attached its handlers: a
 * submit before that would be a native browser form submission, which — for a
 * login form — puts the email *and password* in the URL (history, logs,
 * Referer). Disabled-until-hydrated closes that window entirely.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

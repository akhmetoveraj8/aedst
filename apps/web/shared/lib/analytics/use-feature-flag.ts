"use client";

import { useSyncExternalStore } from "react";

import {
  FEATURE_FLAG_DEFAULTS,
  type FeatureFlag,
  readFeatureFlag,
  subscribeToAnalytics,
} from "@/shared/lib/analytics/analytics";

/**
 * A PostHog feature flag with a typed default. Returns the default during
 * SSR, before consent, without a PostHog key, and until flags have loaded —
 * so a flag can only ever *change* behaviour for visitors who opted in, and
 * the default must always be a safe, complete experience.
 *
 * Not `posthog-js/react`'s hooks: those need the SDK in the initial bundle
 * (a `PostHogProvider` client), which would defeat loading it only after
 * consent.
 */
export function useFeatureFlag<F extends FeatureFlag>(
  flag: F,
): (typeof FEATURE_FLAG_DEFAULTS)[F] {
  return useSyncExternalStore(
    subscribeToAnalytics,
    () => readFeatureFlag(flag),
    () => FEATURE_FLAG_DEFAULTS[flag],
  );
}

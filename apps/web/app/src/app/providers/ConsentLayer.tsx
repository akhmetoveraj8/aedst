"use client";

import { useEffect } from "react";

import {
  disableSessionReplay,
  enableSessionReplay,
} from "@/app/config/sentry/client";
import { ConsentBanner } from "@/app/providers/ConsentBanner";
import {
  disableAnalytics,
  enableAnalytics,
} from "@/shared/lib/analytics/analytics";
import { useConsent } from "@/shared/lib/consent/ConsentProvider";

/**
 * Measurement is opt-in: PostHog (product analytics + feature flags) and
 * Sentry Session Replay start only after the visitor grants consent, and
 * stop again if it is withdrawn. (Sentry *error* reporting is operational
 * rather than behavioural analytics and stays on — see
 * docs/content/decisions.md.) The banner is server-rendered for visitors
 * who have not answered yet.
 */
export function ConsentLayer() {
  const { consent, privacySignal, reviewing } = useConsent();

  useEffect(() => {
    if (consent === "granted") {
      void enableSessionReplay();
      void enableAnalytics();
    } else if (consent === "denied") {
      void disableSessionReplay();
      disableAnalytics();
    }
  }, [consent]);

  if (privacySignal) {
    return null;
  }
  if (consent === "unknown" || reviewing) {
    return <ConsentBanner />;
  }
  return null;
}

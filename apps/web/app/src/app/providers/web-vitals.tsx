"use client";

import { useReportWebVitals } from "next/web-vitals";

import { reportWebVital } from "@/shared/lib/analytics/web-vitals";

/**
 * Field Core Web Vitals (LCP, INP, CLS, FCP, TTFB) into product analytics.
 * Renders nothing. `track()` is a no-op until the visitor has granted
 * analytics consent, so nothing is sent (or even buffered) before that.
 * Lighthouse CI covers lab data; this is the real-user side.
 */
export function WebVitals() {
  useReportWebVitals(reportWebVital);
  return null;
}

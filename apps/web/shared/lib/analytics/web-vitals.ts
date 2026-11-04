import { track } from "@/shared/lib/analytics/analytics";

const REPORTED = new Set(["CLS", "FCP", "INP", "LCP", "TTFB"]);

type Metric = {
  name: string;
  value: number;
  rating?: string;
  navigationType?: string;
};

/**
 * `useReportWebVitals` callback (a stable module-level reference, as the hook
 * requires). Sends only the five Core Web Vitals, rounded: no URL, no ids
 * (PostHog attaches the sanitised page URL itself). CLS is a unitless score,
 * so it keeps three decimals; the others are whole milliseconds.
 */
export function reportWebVital(metric: Metric) {
  if (!REPORTED.has(metric.name)) {
    return;
  }
  const rating =
    metric.rating === "good" || metric.rating === "poor"
      ? metric.rating
      : "needs-improvement";
  track("web_vital", {
    name: metric.name as "CLS" | "FCP" | "INP" | "LCP" | "TTFB",
    value:
      metric.name === "CLS"
        ? Math.round(metric.value * 1000) / 1000
        : Math.round(metric.value),
    rating,
    navigation_type: metric.navigationType ?? "unknown",
  });
}

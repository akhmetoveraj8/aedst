import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  onFeatureFlags: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  getFeatureFlag: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: posthog }));
vi.mock("@/shared/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
    NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
  },
}));

import {
  enableAnalytics,
  resetAnalyticsForTests,
} from "@/shared/lib/analytics/analytics";
import { reportWebVital } from "@/shared/lib/analytics/web-vitals";

beforeEach(() => {
  resetAnalyticsForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reportWebVital", () => {
  it("sends nothing before analytics consent enabled PostHog", () => {
    reportWebVital({ name: "LCP", value: 1234.6, rating: "good" });
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("captures a rounded typed web_vital event after consent", async () => {
    await enableAnalytics();
    reportWebVital({
      name: "LCP",
      value: 1234.6,
      rating: "needs-improvement",
      navigationType: "navigate",
    });
    reportWebVital({ name: "CLS", value: 0.123456, rating: "good" });
    expect(posthog.capture).toHaveBeenNthCalledWith(1, "web_vital", {
      name: "LCP",
      value: 1235,
      rating: "needs-improvement",
      navigation_type: "navigate",
    });
    expect(posthog.capture).toHaveBeenNthCalledWith(2, "web_vital", {
      name: "CLS",
      value: 0.123,
      rating: "good",
      navigation_type: "unknown",
    });
  });

  it("ignores metrics that are not Core Web Vitals (Next.js custom metrics)", async () => {
    await enableAnalytics();
    reportWebVital({ name: "Next.js-hydration", value: 80 });
    expect(posthog.capture).not.toHaveBeenCalled();
  });
});

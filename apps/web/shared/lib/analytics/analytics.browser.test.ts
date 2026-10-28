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

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_POSTHOG_KEY: "phc_test" as string | undefined,
  NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
}));
vi.mock("@/shared/env/client", () => ({ clientEnv: env }));

import {
  disableAnalytics,
  enableAnalytics,
  identifyUser,
  isTrackingBlockedByBrowser,
  readFeatureFlag,
  resetAnalyticsForTests,
  sanitizeEvent,
  toPostHogUiHost,
  track,
} from "@/shared/lib/analytics/analytics";

beforeEach(() => {
  resetAnalyticsForTests();
  env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analytics gates", () => {
  it("captures nothing and loads nothing before enableAnalytics (consent)", () => {
    track("task_completed");
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("stays off without a project key", async () => {
    env.NEXT_PUBLIC_POSTHOG_KEY = undefined;
    expect(await enableAnalytics()).toBeNull();
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("respects Do Not Track and Global Privacy Control", async () => {
    vi.stubGlobal("navigator", { ...navigator, globalPrivacyControl: true });
    expect(isTrackingBlockedByBrowser()).toBe(true);
    expect(await enableAnalytics()).toBeNull();
    expect(posthog.init).not.toHaveBeenCalled();
  });
});

describe("once consented", () => {
  it("initialises through the /ingest proxy with privacy defaults", async () => {
    await enableAnalytics();
    expect(posthog.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: "/ingest",
        ui_host: "https://eu.posthog.com",
        respect_dnt: true,
        disable_session_recording: true,
        disable_external_dependency_loading: true,
        person_profiles: "identified_only",
      }),
    );
  });

  it("tracks typed events, identifies by id only, resets on sign-out", async () => {
    await enableAnalytics();
    track("search_performed", { query_length: 4, results: 2 });
    expect(posthog.capture).toHaveBeenCalledWith("search_performed", {
      query_length: 4,
      results: 2,
    });

    identifyUser("user-1");
    expect(posthog.identify).toHaveBeenCalledWith("user-1");
    identifyUser(null);
    expect(posthog.reset).toHaveBeenCalled();
  });

  it("opts out and forgets the browser when consent is withdrawn", async () => {
    await enableAnalytics();
    disableAnalytics();
    expect(posthog.opt_out_capturing).toHaveBeenCalled();
    expect(posthog.reset).toHaveBeenCalled();
  });

  it("falls back to the typed default for missing or mistyped flags", async () => {
    expect(readFeatureFlag("command-palette")).toBe(true);
    await enableAnalytics();
    posthog.getFeatureFlag.mockReturnValueOnce(false);
    expect(readFeatureFlag("command-palette")).toBe(false);
    posthog.getFeatureFlag.mockReturnValueOnce("variant-b");
    expect(readFeatureFlag("command-palette")).toBe(true);
  });
});

describe("toPostHogUiHost", () => {
  it("maps ingestion hosts to the app host", () => {
    expect(toPostHogUiHost("https://us.i.posthog.com")).toBe(
      "https://us.posthog.com",
    );
    expect(toPostHogUiHost("https://ph.example.com")).toBe(
      "https://ph.example.com",
    );
  });
});

describe("pageview sanitising", () => {
  it("registers before_send and strips q/next from URLs", async () => {
    await enableAnalytics();
    const options = posthog.init.mock.calls.at(-1)?.[1];
    expect(options.before_send).toBe(sanitizeEvent);
    const event = sanitizeEvent({
      event: "$pageview",
      properties: Object.fromEntries([
        ["$current_url", "https://app.test/en/search?q=hello&kind=task"],
        ["$referrer", "https://app.test/en/sign-in?next=%2Fadmin"],
        ["$pathname", "/en/search"],
      ]),
    });
    expect(event?.properties).toEqual(
      Object.fromEntries([
        ["$current_url", "https://app.test/en/search?q=[Filtered]&kind=task"],
        ["$referrer", "https://app.test/en/sign-in?next=[Filtered]"],
        ["$pathname", "/en/search"],
      ]),
    );
  });

  it("passes a dropped event (null) through", () => {
    expect(sanitizeEvent(null)).toBeNull();
  });
});

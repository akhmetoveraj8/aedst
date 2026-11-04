import { afterEach, describe, expect, it, vi } from "vitest";

import { clearAppBadge, setAppBadge } from "@/shared/lib/pwa/app-badge";

function stubNavigator(value: unknown) {
  vi.stubGlobal("navigator", value);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("app badge", () => {
  it("sets the count and clears on zero", async () => {
    const nav = {
      setAppBadge: vi.fn().mockResolvedValue(undefined),
      clearAppBadge: vi.fn().mockResolvedValue(undefined),
    };
    stubNavigator(nav);
    await setAppBadge(3);
    expect(nav.setAppBadge).toHaveBeenCalledWith(3);
    await setAppBadge(0);
    expect(nav.clearAppBadge).toHaveBeenCalledTimes(1);
    await clearAppBadge();
    expect(nav.clearAppBadge).toHaveBeenCalledTimes(2);
  });

  it("shows the plain badge without a count", async () => {
    const nav = { setAppBadge: vi.fn().mockResolvedValue(undefined) };
    stubNavigator(nav);
    await setAppBadge();
    expect(nav.setAppBadge).toHaveBeenCalledWith(undefined);
  });

  it("is a no-op when the API is missing and swallows rejections", async () => {
    stubNavigator({});
    await expect(setAppBadge(2)).resolves.toBeUndefined();
    await expect(clearAppBadge()).resolves.toBeUndefined();
    stubNavigator({ setAppBadge: vi.fn().mockRejectedValue(new Error("no")) });
    await expect(setAppBadge(2)).resolves.toBeUndefined();
  });
});

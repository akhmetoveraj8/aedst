import { beforeEach, describe, expect, it } from "vitest";

import {
  isInstallPromptSnoozed,
  useUiPreferences,
} from "@/shared/lib/stores/ui-preferences-store";

describe("useUiPreferences", () => {
  beforeEach(() => {
    useUiPreferences.setState({ installPromptDismissedAt: null });
  });

  it("remembers a dismissed install prompt in localStorage", () => {
    useUiPreferences.getState().dismissInstallPrompt();
    expect(useUiPreferences.getState().installPromptDismissedAt).toEqual(
      expect.any(Number),
    );
    expect(localStorage.getItem("aedst-ui-preferences")).toContain(
      "installPromptDismissedAt",
    );
  });

  it("snoozes the prompt for 30 days", () => {
    const now = 1_000_000_000_000;
    expect(isInstallPromptSnoozed(null, now)).toBe(false);
    expect(isInstallPromptSnoozed(now - 1_000, now)).toBe(true);
    expect(isInstallPromptSnoozed(now - 31 * 24 * 3600 * 1000, now)).toBe(
      false,
    );
  });
});

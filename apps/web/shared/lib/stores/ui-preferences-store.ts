"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Per-device UI preferences — client UI state only, never server data
 * (that is TanStack Query's job; see src/shared/README.md "State").
 * Persisted to localStorage by zustand's `persist` middleware; nothing in
 * here is sensitive.
 */
type UiPreferences = {
  /** Epoch ms the install banner was dismissed, or null. */
  installPromptDismissedAt: number | null;
  dismissInstallPrompt: () => void;
};

const INSTALL_PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export const useUiPreferences = create<UiPreferences>()(
  persist(
    (set) => ({
      installPromptDismissedAt: null,
      dismissInstallPrompt: () => set({ installPromptDismissedAt: Date.now() }),
    }),
    {
      name: "aedst-ui-preferences",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Rehydrated after mount (see AppShell), so server and first client
      // render agree and there is no hydration mismatch.
      skipHydration: true,
    },
  ),
);

export function isInstallPromptSnoozed(
  dismissedAt: number | null,
  now: number = Date.now(),
): boolean {
  return dismissedAt !== null && now - dismissedAt < INSTALL_PROMPT_SNOOZE_MS;
}

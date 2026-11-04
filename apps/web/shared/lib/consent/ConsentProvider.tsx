"use client";

import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  useTransition,
} from "react";
import { saveConsentAction } from "@/shared/lib/consent/consent-action";
import type { ConsentState } from "@/shared/lib/consent/consent-cookie";

type ConsentContextValue = {
  consent: ConsentState;
  grant: () => void;
  deny: () => void;
  /** The browser sent Global Privacy Control: treated as a decline, no prompt. */
  privacySignal: boolean;
  /** The visitor reopened the prompt to change or withdraw an earlier answer. */
  reviewing: boolean;
  review: () => void;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

/**
 * Whether the visitor allowed analytics/performance measurement. Seeded by
 * the server from the consent cookie (`initial`), so the very first render
 * already knows the answer. Measurement code must treat anything but
 * `granted` as off — opt-in, not opt-out.
 */
export function ConsentProvider({
  initial,
  privacySignal = false,
  children,
}: {
  initial: ConsentState;
  privacySignal?: boolean;
  children: React.ReactNode;
}) {
  const [consent, setConsent] = useState<ConsentState>(
    privacySignal ? "denied" : initial,
  );
  const [reviewing, setReviewing] = useState(false);
  const [, startTransition] = useTransition();

  const choose = useCallback(
    (choice: "granted" | "denied") => {
      if (privacySignal && choice === "granted") {
        return;
      }
      setReviewing(false);
      // Optimistic: the UI (and measurement) follows immediately; the cookie
      // write is best effort — if it fails the choice still holds until reload.
      setConsent(choice);
      startTransition(async () => {
        try {
          await saveConsentAction(choice);
        } catch {
          // Kept in memory for this page view only.
        }
      });
    },
    [privacySignal],
  );

  const value = useMemo<ConsentContextValue>(
    () => ({
      consent,
      grant: () => choose("granted"),
      deny: () => choose("denied"),
      privacySignal,
      reviewing,
      review: () => setReviewing(true),
    }),
    [consent, choose, privacySignal, reviewing],
  );

  return <ConsentContext value={value}>{children}</ConsentContext>;
}

export function useConsent(): ConsentContextValue {
  const ctx = use(ConsentContext);
  if (!ctx) {
    throw new Error("useConsent() must be called within <ConsentProvider>");
  }
  return ctx;
}

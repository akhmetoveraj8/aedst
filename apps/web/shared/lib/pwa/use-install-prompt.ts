"use client";

import { useCallback, useEffect, useState } from "react";

/** Chromium's install event (not in lib.dom). */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallState =
  /** Already running as an installed app, or nothing to offer. */
  | { kind: "unavailable" }
  /** Chromium: we hold a deferred `beforeinstallprompt` and can prompt. */
  | { kind: "promptable"; install: () => Promise<"accepted" | "dismissed"> }
  /** iOS/iPadOS Safari: no prompt API — show "Share → Add to Home Screen". */
  | { kind: "ios" };

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac with touch.
    (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return iOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/**
 * Install UX across engines: Chromium fires `beforeinstallprompt` (kept and
 * replayed from a button), iOS Safari has no API and gets instructions,
 * Firefox/desktop Safari use their own browser UI (nothing to show).
 */
export function useInstallPrompt(): InstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [platform, setPlatform] = useState<"standalone" | "ios" | "other">(
    "other",
  );

  useEffect(() => {
    setPlatform(
      isStandalone() ? "standalone" : isIosSafari() ? "ios" : "other",
    );
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setPlatform("standalone");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) {
      return "dismissed" as const;
    }
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    return outcome;
  }, [deferred]);

  if (platform === "standalone") {
    return { kind: "unavailable" };
  }
  if (deferred) {
    return { kind: "promptable", install };
  }
  return platform === "ios" ? { kind: "ios" } : { kind: "unavailable" };
}

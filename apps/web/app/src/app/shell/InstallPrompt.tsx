"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { track } from "@/shared/lib/analytics/analytics";
import { useInstallPrompt } from "@/shared/lib/pwa/use-install-prompt";
import {
  isInstallPromptSnoozed,
  useUiPreferences,
} from "@/shared/lib/stores/ui-preferences-store";
import { Button } from "@/shared/ui/button";

/**
 * "Install the app" card: Chromium replays the deferred
 * `beforeinstallprompt`; iOS Safari (no API) gets the Share → Add to Home
 * Screen instructions — installing is what enables Web Push on iOS. A
 * dismissal snoozes it for 30 days on this device (zustand, persisted).
 * Inline in the signed-in shell (never a fixed overlay covering content),
 * and only after sign-in, when installing is actually useful.
 */
export function InstallPrompt() {
  const t = useTranslations("common.pwa");
  const state = useInstallPrompt();
  const dismissedAt = useUiPreferences((s) => s.installPromptDismissedAt);
  const dismiss = useUiPreferences((s) => s.dismissInstallPrompt);

  useEffect(() => {
    void useUiPreferences.persist.rehydrate();
  }, []);

  if (state.kind === "unavailable" || isInstallPromptSnoozed(dismissedAt)) {
    return null;
  }

  return (
    <section
      aria-label={t("installTitle")}
      className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="font-medium text-sm">{t("installTitle")}</p>
        <p className="text-muted-foreground text-xs">
          {state.kind === "ios"
            ? t("iosInstructions")
            : t("installDescription")}
        </p>
      </div>
      <div className="flex shrink-0 justify-end gap-2">
        <Button variant="outline" size="sm" onClick={dismiss}>
          {t("dismiss")}
        </Button>
        {state.kind === "promptable" && (
          <Button
            size="sm"
            onClick={async () => {
              const outcome = await state.install();
              track("pwa_install_prompt", { outcome });
              if (outcome === "dismissed") {
                dismiss();
              }
            }}
          >
            {t("install")}
          </Button>
        )}
      </div>
    </section>
  );
}

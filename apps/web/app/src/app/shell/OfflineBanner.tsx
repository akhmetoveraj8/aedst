"use client";

import { useTranslations } from "next-intl";

import { useOnlineStatus } from "@/shared/lib/hooks/use-online-status";

/** Tells the user why things stopped loading — announced politely. */
export function OfflineBanner() {
  const t = useTranslations("common.offline");
  const online = useOnlineStatus();

  return (
    <div role="status" aria-live="polite">
      {!online && (
        <p className="bg-warning px-4 py-2 text-center text-sm text-warning-foreground">
          {t("banner")} <span>{t("queued")}</span>
        </p>
      )}
    </div>
  );
}

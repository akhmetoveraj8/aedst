"use client";

import { useTranslations } from "next-intl";

import { useConsent } from "@/shared/lib/consent/ConsentProvider";
import { Button } from "@/shared/ui/button";

/**
 * Lets a visitor who already answered reopen the consent prompt (to change or
 * withdraw it). It sits in the page flow (the app footer and the sign-in page),
 * not over the content. Nothing to manage while the question is still open (the
 * banner is showing) or when Global Privacy Control already declines.
 */
export function PrivacySettingsButton({ className }: { className?: string }) {
  const { consent, privacySignal, review } = useConsent();
  const t = useTranslations("common.consent");

  if (privacySignal || consent === "unknown") {
    return null;
  }
  return (
    <Button variant="ghost" size="xs" className={className} onClick={review}>
      {t("manage")}
    </Button>
  );
}

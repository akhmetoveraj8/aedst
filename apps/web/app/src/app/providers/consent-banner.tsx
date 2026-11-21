"use client";

import { useTranslations } from "next-intl";

import { clientEnv } from "@/shared/env/client";
import { useConsent } from "@/shared/lib/consent/ConsentProvider";
import { Button } from "@/shared/ui/button";

export function ConsentBanner() {
  const t = useTranslations("common.consent");
  const { consent, grant, deny } = useConsent();
  const privacyUrl = clientEnv.NEXT_PUBLIC_PRIVACY_POLICY_URL;

  return (
    <section
      aria-label={t("title")}
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl flex-col gap-3 rounded-xl border bg-background p-4 shadow-lg sm:flex-row sm:items-center"
    >
      {/* text-xs: the banner must never out-size the page heading, or it becomes
          the Largest Contentful Paint element (it renders after hydration). */}
      <p className="text-xs">
        {t("description")}
        {consent === "unknown"
          ? null
          : ` ${t(consent === "granted" ? "currentlyAllowed" : "currentlyDeclined")}`}
        {privacyUrl ? (
          <>
            {" "}
            <a
              href={privacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {t("privacyPolicy")}
            </a>
          </>
        ) : null}
      </p>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" onClick={deny}>
          {consent === "granted" ? t("withdraw") : t("decline")}
        </Button>
        <Button size="sm" onClick={grant}>
          {t("accept")}
        </Button>
      </div>
    </section>
  );
}

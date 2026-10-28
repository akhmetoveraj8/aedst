"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { reportError } from "@/shared/lib/errors/report-error";
import { Button } from "@/shared/ui/button";

type LocaleErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function LocaleError({ error, reset }: LocaleErrorProps) {
  const t = useTranslations("common");

  useEffect(() => {
    // Sentry is not initialised on the landing site, so this is a no-op until
    // an instrumentation-client.ts is added; kept so the path is one line away.
    reportError(error, {
      source: "route",
      extra: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <h1 className="font-semibold text-2xl">{t("errors.title")}</h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {t("errors.generic")}
      </p>
      <Button onClick={reset}>{t("actions.tryAgain")}</Button>
    </div>
  );
}

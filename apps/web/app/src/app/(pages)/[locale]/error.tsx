"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { PageMain } from "@/app/shell/PageMain";

import { reportError } from "@/shared/lib/errors/report-error";
import { Button } from "@/shared/ui/button";

type LocaleErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function LocaleError({ error, reset }: LocaleErrorProps) {
  const t = useTranslations("common");

  useEffect(() => {
    reportError(error, {
      source: "route",
      extra: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);

  return (
    <PageMain className="items-center justify-center gap-4 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold text-foreground">
        {t("errors.title")}
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {t("errors.generic")}
      </p>
      <Button onClick={reset}>{t("actions.tryAgain")}</Button>
    </PageMain>
  );
}

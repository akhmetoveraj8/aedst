import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslations } from "use-intl";

import { PageMain } from "@/app/shell/PageMain";
import { reportError } from "@/shared/lib/errors/report-error";
import { Button } from "@/shared/ui/button";

/** Route error screen inside the locale layout (translated, retryable). */
export function LocaleError({ error, reset }: ErrorComponentProps) {
  const t = useTranslations("common");

  useEffect(() => {
    reportError(error, { source: "route" });
  }, [error]);

  return (
    <PageMain className="items-center justify-center gap-4 px-4 py-24 text-center">
      <title>{t("errors.title")}</title>
      <h1 className="font-semibold text-2xl text-foreground">
        {t("errors.title")}
      </h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {t("errors.generic")}
      </p>
      <Button onClick={reset}>{t("actions.tryAgain")}</Button>
    </PageMain>
  );
}

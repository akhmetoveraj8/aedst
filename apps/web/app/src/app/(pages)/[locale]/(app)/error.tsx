"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { reportError } from "@/shared/lib/errors/report-error";
import { Button } from "@/shared/ui/button";

/**
 * Route-level boundary for the signed-in area: the shell (header, nav)
 * stays usable while the failed page offers a retry. Reported with the same
 * tags as every other error; the digest links it to the server-side event
 * (`onRequestError` in instrumentation.ts) when a Server Component threw.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

  useEffect(() => {
    reportError(error, {
      source: "route",
      extra: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 py-16 text-center"
    >
      <h1 className="font-semibold text-xl">{t("errors.title")}</h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {t("errors.generic")}
      </p>
      <Button onClick={reset}>{t("actions.tryAgain")}</Button>
    </div>
  );
}

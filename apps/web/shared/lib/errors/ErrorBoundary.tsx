"use client";

import * as Sentry from "@sentry/nextjs";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { toAppError } from "@/shared/lib/errors/app-error";
import { Button } from "@/shared/ui/button";

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Feature that owns the subtree, tagged on the Sentry event. */
  feature?: string;
  /**
   * What to render instead of a crashed subtree. Omitted: a translated
   * "something went wrong" with a retry button. `null`: render nothing
   * (for optional header widgets). A plain element, not a render function,
   * so Server Components can pass it.
   */
  fallback?: ReactNode;
};

/**
 * Isolates a widget so one crashing section does not blank the page (the
 * route-level `error.tsx` replaces the whole segment). Built on Sentry's own
 * `ErrorBoundary` rather than a hand-rolled class component — it already
 * captures the error with its component stack; `beforeCapture` adds the
 * same tags `reportError` puts on every other error (`error.kind`,
 * `error.source`, `feature`), so boundary events group and filter alike.
 */
export function ErrorBoundary({
  children,
  feature,
  fallback,
}: ErrorBoundaryProps) {
  return (
    <Sentry.ErrorBoundary
      beforeCapture={(scope, error) => {
        scope.setTag("error.kind", toAppError(error).kind);
        scope.setTag("error.source", "boundary");
        if (feature) {
          scope.setTag("feature", feature);
        }
      }}
      fallback={({ resetError }) =>
        fallback === undefined ? (
          <ErrorFallback reset={resetError} />
        ) : (
          <StaticFallback>{fallback}</StaticFallback>
        )
      }
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}

function StaticFallback({ children }: { children: ReactNode }) {
  return children;
}

function ErrorFallback({ reset }: { reset: () => void }) {
  const t = useTranslations("common");
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 p-4"
    >
      <p className="font-medium">{t("errors.title")}</p>
      <p className="text-muted-foreground text-sm">{t("errors.generic")}</p>
      <Button variant="outline" size="sm" onClick={reset}>
        {t("actions.tryAgain")}
      </Button>
    </div>
  );
}

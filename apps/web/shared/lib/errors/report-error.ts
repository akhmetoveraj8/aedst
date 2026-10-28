import * as Sentry from "@sentry/nextjs";

import { shouldReport, toAppError } from "@/shared/lib/errors/app-error";

type ErrorSource =
  | "query"
  | "mutation"
  | "boundary"
  | "route"
  | "upload"
  | "push"
  | "service-worker"
  | "bff";

export type ErrorContext = {
  source: ErrorSource;
  /** Connect procedure (`aedst.tasks.v1.TasksService/GetTask`) when known. */
  procedure?: string;
  /** Feature module that owns the failing code (`tasks`, `media`, …). */
  feature?: string;
  /** React component stack from an error boundary. */
  componentStack?: string;
  /** Free-form, non-PII extras. */
  extra?: Record<string, unknown>;
};

/**
 * The single path from "something failed" to Sentry, so every error carries
 * the same tags (`error.kind`, `error.source`, `rpc.procedure`, `feature`)
 * whether it surfaced in a query, a mutation, a boundary or an upload. Expected
 * failures (definitive server answers, offline) are dropped here, which is
 * what keeps the issue stream actionable. Returns the Sentry event id, if any.
 */
export function reportError(
  error: unknown,
  context: ErrorContext,
): string | undefined {
  const appError = toAppError(error);
  // A render crash (boundary / route error.tsx) is always a bug, whatever
  // error object it carried.
  const isCrash = context.source === "boundary" || context.source === "route";
  if (!isCrash && !shouldReport(appError)) {
    return undefined;
  }
  return Sentry.withScope((scope) => {
    scope.setTag("error.kind", appError.kind);
    scope.setTag("error.source", context.source);
    if (appError.code) {
      scope.setTag("rpc.code", appError.code);
    }
    if (context.procedure) {
      scope.setTag("rpc.procedure", context.procedure);
    }
    if (context.feature) {
      scope.setTag("feature", context.feature);
    }
    if (context.componentStack) {
      scope.setContext("react", { componentStack: context.componentStack });
    }
    if (context.extra) {
      scope.setContext("details", context.extra);
    }
    if (context.procedure) {
      // One issue per failing procedure and code, not one per message text.
      scope.setFingerprint([
        "{{ default }}",
        context.procedure,
        appError.code ?? appError.kind,
      ]);
    }
    return Sentry.captureException(error);
  });
}

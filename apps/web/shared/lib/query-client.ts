import { Code, ConnectError } from "@connectrpc/connect";
import {
  type Mutation,
  MutationCache,
  type Query,
  QueryCache,
  QueryClient,
} from "@tanstack/react-query";

import {
  type AppError,
  isRetryable,
  retryDelayMs,
  toAppError,
} from "@/shared/lib/errors/app-error";
import { addBreadcrumb } from "@/shared/lib/errors/breadcrumbs";
import { reportError } from "@/shared/lib/errors/report-error";

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ConnectError && error.code === Code.Unauthenticated;
}

/** Retries after the first attempt for a retryable query failure. */
const QUERY_RETRIES = 2;

export type QueryClientCallbacks = {
  /** A call came back `Unauthenticated` even after the BFF's refresh attempt. */
  onUnauthenticated?: () => void;
  /**
   * A failure the user should hear about (the provider turns it into a
   * deduplicated, translated toast): any failed mutation that does not
   * render its own error, and a failed *background* refetch of a query that
   * already shows data — a first load renders its own error state instead.
   */
  onUserFacingError?: (error: AppError) => void;
};

/**
 * `aedst.tasks.v1.TasksService/GetTask` from a connect-query key
 * (`["connect-query", { serviceName, methodName, … }]`), for error context.
 */
export function procedureFromKey(
  key: readonly unknown[] | undefined,
): string | undefined {
  const descriptor = key?.[1];
  if (
    typeof descriptor === "object" &&
    descriptor !== null &&
    "serviceName" in descriptor &&
    "methodName" in descriptor
  ) {
    const { serviceName, methodName } = descriptor as {
      serviceName: unknown;
      methodName: unknown;
    };
    if (typeof serviceName === "string" && typeof methodName === "string") {
      return `${serviceName}/${methodName}`;
    }
  }
  return undefined;
}

/**
 * Mutations opt out of the global error toast with `meta: { silent: true }`
 * when they render their own inline error (the auth forms do).
 */
function isSilent(mutation: Mutation<unknown, unknown, unknown, unknown>) {
  return mutation.meta?.silent === true;
}

function hadData(query: Query<unknown, unknown, unknown, readonly unknown[]>) {
  return query.state.data !== undefined;
}

function featureFromMeta(meta: Record<string, unknown> | undefined) {
  return typeof meta?.feature === "string" ? meta.feature : undefined;
}

export function makeQueryClient(callbacks: QueryClientCallbacks = {}) {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        const appError = toAppError(error);
        reportError(error, {
          source: "query",
          procedure: procedureFromKey(query.queryKey),
          feature: featureFromMeta(query.meta),
        });
        if (appError.kind === "unauthenticated") {
          callbacks.onUnauthenticated?.();
        } else if (hadData(query) && appError.kind !== "cancelled") {
          callbacks.onUserFacingError?.(appError);
        }
      },
    }),
    mutationCache: new MutationCache({
      // Every user action leaves a breadcrumb, so a Sentry event shows what
      // the user did leading up to it.
      onMutate: (_variables, mutation) => {
        addBreadcrumb({
          category: "mutation",
          level: "info",
          message:
            procedureFromKey(mutation.options.mutationKey) ??
            mutation.options.mutationKey?.join("/") ??
            "mutation",
        });
      },
      onError: (error, _variables, _context, mutation) => {
        const appError = toAppError(error);
        reportError(error, {
          source: "mutation",
          procedure: procedureFromKey(mutation.options.mutationKey),
          feature: featureFromMeta(mutation.meta),
        });
        if (appError.kind === "unauthenticated") {
          callbacks.onUnauthenticated?.();
        } else if (!isSilent(mutation) && appError.kind !== "cancelled") {
          callbacks.onUserFacingError?.(appError);
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        // Retrying a request the server definitively rejected (the 4xx
        // family) only delays the error; transient failures — outages,
        // timeouts, rate limits — back off with jitter and try again.
        retry: (failureCount, error) =>
          isRetryable(toAppError(error)) && failureCount < QUERY_RETRIES,
        retryDelay: (attempt, error) =>
          retryDelayMs(attempt, toAppError(error)),
        refetchOnWindowFocus: false,
      },
      mutations: {
        // Mutations are not assumed idempotent; the user retries explicitly.
        retry: 0,
      },
    },
  });
}

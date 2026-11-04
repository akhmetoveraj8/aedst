import { Code, ConnectError } from "@connectrpc/connect";

/**
 * The app's one error vocabulary. Every failure — a ConnectError from
 * apps/server, a dropped network, a bug — is classified into one of these
 * kinds, and everything downstream (retry policy, toast text, Sentry
 * reporting, error boundaries) decides by kind, never by parsing messages.
 * Server messages are diagnostic English and never shown to users; each
 * kind has a translated message under `common.errors.kinds`.
 *
 * The vocabulary, the Connect code mapping and the retryable/reportable
 * flags are shared with Android, Apple and Desktop through
 * docs/contract/behavior/error-kinds.json (replayed by
 * src/test/contract/error-kinds.replay.test.ts).
 */
export type AppErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "notFound"
  | "invalidInput"
  | "conflict"
  | "rateLimited"
  | "unavailable"
  | "timeout"
  | "offline"
  | "cancelled"
  | "upgradeRequired"
  | "storage"
  | "unknown";

export type AppError = {
  kind: AppErrorKind;
  /** The Connect code name when the error came from an RPC. */
  code?: string;
  /** Developer-facing detail; never render it. */
  message: string;
  cause: unknown;
};

const KIND_BY_CODE: Partial<Record<Code, AppErrorKind>> = {
  [Code.Unauthenticated]: "unauthenticated",
  [Code.PermissionDenied]: "forbidden",
  [Code.NotFound]: "notFound",
  [Code.InvalidArgument]: "invalidInput",
  [Code.OutOfRange]: "invalidInput",
  [Code.FailedPrecondition]: "invalidInput",
  [Code.AlreadyExists]: "conflict",
  [Code.Aborted]: "conflict",
  [Code.ResourceExhausted]: "rateLimited",
  [Code.Unavailable]: "unavailable",
  [Code.DeadlineExceeded]: "timeout",
  [Code.Canceled]: "cancelled",
};

const UPGRADE_REQUIRED_REASON = "CLIENT_UPGRADE_REQUIRED";
const ERROR_INFO_TYPE = "google.rpc.ErrorInfo";

/**
 * True when the server's client-version gate refused this build: Connect
 * failed_precondition AND a google.rpc.ErrorInfo detail whose `reason`
 * (field 1) is CLIENT_UPGRADE_REQUIRED. The code alone is an ordinary
 * business error. Only this one field is read, so no google.rpc schema is
 * pulled in.
 */
function isUpgradeRequired(error: ConnectError) {
  if (error.code !== Code.FailedPrecondition) {
    return false;
  }
  const decoder = new TextDecoder();
  return error.details.some((detail) => {
    if (!("type" in detail) || detail.type !== ERROR_INFO_TYPE) {
      return false;
    }
    const bytes: Uint8Array = detail.value;
    return (
      bytes[0] === 0x0a &&
      decoder.decode(bytes.subarray(2, 2 + bytes[1])) ===
        UPGRADE_REQUIRED_REASON
    );
  });
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function toAppError(error: unknown): AppError {
  if (error instanceof ConnectError) {
    let kind: AppErrorKind = isUpgradeRequired(error)
      ? "upgradeRequired"
      : (KIND_BY_CODE[error.code] ?? "unknown");
    if ((kind === "unavailable" || kind === "unknown") && isOffline()) {
      kind = "offline";
    }
    return {
      kind,
      code: Code[error.code],
      message: error.rawMessage,
      cause: error,
    };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { kind: "cancelled", message: error.message, cause: error };
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return { kind: "timeout", message: error.message, cause: error };
  }
  if (isOffline()) {
    return { kind: "offline", message: String(error), cause: error };
  }
  return {
    kind: "unknown",
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  };
}

/**
 * Transient failures: the same request may succeed later. Definitive answers
 * from the server (the "4xx" family), a client cancel, a required upgrade and
 * an unclassified bug give the same result when repeated. Same flags as
 * error-kinds.json.
 */
const RETRYABLE: ReadonlySet<AppErrorKind> = new Set([
  "rateLimited",
  "unavailable",
  "offline",
  "timeout",
]);

export function isRetryable(error: AppError): boolean {
  return RETRYABLE.has(error.kind);
}

/**
 * Worth an incident: bugs and storage faults. Expected states (offline, a
 * rate limit, a client-side cancel, definitive answers) are control flow, and
 * server faults are already captured server-side.
 */
export function shouldReport(error: AppError): boolean {
  return error.kind === "unknown" || error.kind === "storage";
}

/** The `common.errors.kinds.*` message key for a kind. */
export function errorMessageKey(kind: AppErrorKind) {
  return `kinds.${kind}` as const;
}

/**
 * Exponential backoff with full jitter for retryable failures; a rate
 * limit waits longer. Capped so a user is never left waiting for minutes.
 */
export function retryDelayMs(attempt: number, error: AppError): number {
  const base = error.kind === "rateLimited" ? 2_000 : 500;
  const ceiling = Math.min(base * 2 ** attempt, 15_000);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

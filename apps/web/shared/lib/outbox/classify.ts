import { isRetryable, toAppError } from "@/shared/lib/errors/app-error";
import type { DeliveryOutcome } from "@/shared/lib/outbox/types";

/**
 * Maps a failed delivery to a contract outcome using the app's one error
 * vocabulary: a definitive server answer (invalid input, forbidden, not
 * found, conflict) is `permanent`; offline, timeouts, 5xx, rate limits and an
 * expired session (`unauthenticated` - the user can sign in again) are
 * `retryable`.
 */
export function outcomeForError(error: unknown): DeliveryOutcome {
  const appError = toAppError(error);
  if (appError.kind === "unauthenticated") {
    return "retryable";
  }
  return isRetryable(appError) ? "retryable" : "permanent";
}

// Pure budget classification shared by check-bundle-size.mjs and its test.

/** A budget is "warn" from this share of the limit, so growth is visible before CI goes red. */
export const WARN_RATIO = 0.95;

/**
 * @param {number} actual
 * @param {number} limit
 * @returns {"ok" | "warn" | "fail"}
 */
export function budgetStatus(actual, limit) {
  if (actual > limit) {
    return "fail";
  }
  return actual >= limit * WARN_RATIO ? "warn" : "ok";
}

export const STATUS_LABEL = { ok: "ok  ", warn: "WARN", fail: "FAIL" };

/**
 * True when a chunk's source contains the Sentry Replay recorder (rrweb).
 * It must stay in an async chunk loaded after analytics consent, never in a
 * route's first load.
 * @param {string} source
 */
export function containsReplayRecorder(source) {
  return source.includes("recordingMode") && source.includes("rrweb");
}

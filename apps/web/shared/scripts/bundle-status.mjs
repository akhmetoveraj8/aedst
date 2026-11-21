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

/**
 * URLs of the scripts a built Vite `index.html` makes every visit download:
 * the module entry plus its `modulepreload` links.
 * @param {string} html
 * @returns {string[]}
 */
export function entryScripts(html) {
  const urls = [];
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
    const isEntry = /^<script\b/.test(tag) && /\bsrc=/.test(tag);
    const isPreload = /^<link\b/.test(tag) && /rel="modulepreload"/.test(tag);
    const url = /\b(?:src|href)="([^"]+)"/.exec(tag)?.[1];
    if ((isEntry || isPreload) && url) {
      urls.push(url);
    }
  }
  return urls;
}

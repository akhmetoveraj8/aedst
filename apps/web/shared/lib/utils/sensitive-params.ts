/**
 * Query parameters whose values must never leave the browser in telemetry:
 * credentials and one-time secrets (OAuth callbacks, password-reset links,
 * presigned media URLs) plus parameters that carry user content or a private
 * destination (`q` is a search text, `next` a post-sign-in return path).
 * Shared by Sentry URL scrubbing and the PostHog pageview sanitizer.
 */

const SENSITIVE_QUERY_PARAMS = [
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "code",
  "state",
  "password",
  "secret",
  "key",
  "signature",
  "x-amz-signature",
  "x-amz-credential",
  "x-amz-security-token",
  "sig",
  "q",
  "next",
  "return_to",
  "redirect",
  "redirect_uri",
] as const;

const SENSITIVE = new Set<string>(SENSITIVE_QUERY_PARAMS);

const FILTERED = "[Filtered]";

/** Replaces the value of every sensitive query parameter of an absolute or relative URL. */
export function redactSensitiveParams(url: string): string {
  const hashAt = url.indexOf("#");
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const withoutHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = withoutHash.indexOf("?");
  if (queryAt === -1) {
    return url;
  }
  const query = withoutHash
    .slice(queryAt + 1)
    .split("&")
    .map((pair) => {
      const [name] = pair.split("=", 1);
      let decoded = name ?? "";
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        // keep the raw name
      }
      return pair.includes("=") && SENSITIVE.has(decoded.toLowerCase())
        ? `${name}=${FILTERED}`
        : pair;
    })
    .join("&");
  return `${withoutHash.slice(0, queryAt + 1)}${query}${hash}`;
}

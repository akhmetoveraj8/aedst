// The one definition of the marketing site's security headers. Imported by
// `build-security-headers.mjs` (production headers) and by the unit test.
// A new third-party origin must be added here in the same change (and named in
// the PR); the Lighthouse `third-party:count` budget is 0.

/** Directives that never change. `script-src` is added per page. */
const STATIC_DIRECTIVES = [
  "default-src 'self'",
  // Fonts and the Tailwind stylesheet are files; Next emits no inline <style>
  // on the localized pages (the build script fails if it ever does).
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
];

/** @param {readonly string[]} scriptHashes `'sha256-...'` sources of one page */
export function buildCsp(scriptHashes) {
  const scriptSrc = ["script-src", "'self'", ...scriptHashes].join(" ");
  return [STATIC_DIRECTIVES[0], scriptSrc, ...STATIC_DIRECTIVES.slice(1)].join(
    "; ",
  );
}

/** For files that are not documents (assets, text, JSON): nothing may run. */
export const CSP_FALLBACK =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const COMMON_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off",
};
